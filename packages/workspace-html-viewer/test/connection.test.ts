import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectHtmlView } from "../src/connection.js";

const sdk = vi.hoisted(() => ({
  host: { flush: vi.fn(), hasPendingChanges: vi.fn(), dispose: vi.fn() },
  createBindingHost: vi.fn(),
  createHtmlViewDocument: vi.fn(),
  parseHtmlView: vi.fn(),
}));
vi.mock("@univerjs-labs/html-view", () => ({ parseHtmlView: sdk.parseHtmlView }));
vi.mock("@univerjs-labs/html-view-renderer", () => sdk);
let events: EventTarget;
let iframe: HTMLIFrameElement;
const loadEngine = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  events = new EventTarget();
  vi.stubGlobal("window", events);
  sdk.createBindingHost.mockReturnValue(sdk.host);
  sdk.createHtmlViewDocument.mockReturnValue("<html><head></head><body></body></html>");
  iframe = { contentWindow: {}, srcdoc: "" } as unknown as HTMLIFrameElement;
});
afterEach(() => vi.unstubAllGlobals());
function message(overrides: Record<string, unknown> = {}) {
  const port = { close: vi.fn() };
  const token = sdk.createHtmlViewDocument.mock.calls[0]![0].connectionId;
  events.dispatchEvent(
    Object.assign(new Event("message"), {
      source: iframe.contentWindow,
      origin: "null",
      data: { type: "univer-html-view-connect", token },
      ports: [port],
      ...overrides,
    }),
  );
  return port;
}
it("accepts only the current sandbox window, null origin and connection token", () => {
  const connection = connectHtmlView(iframe, {
    source: "template",
    runtime: "runtime",
    loadEngine,
  });
  message({ source: {} });
  message({ origin: "https://foreign.example" });
  message({ data: { type: "univer-html-view-connect", token: "old" } });
  message({ ports: [] });
  expect(sdk.createBindingHost).not.toHaveBeenCalled();
  const accepted = message();
  expect(sdk.createBindingHost).toHaveBeenCalledWith(
    accepted,
    expect.objectContaining({ loadEngine }),
  );
  expect(message().close).toHaveBeenCalledOnce();
  expect(sdk.createBindingHost).toHaveBeenCalledOnce();
  connection.dispose();
  message();
  expect(sdk.createBindingHost).toHaveBeenCalledOnce();
});
it("preserves origin policy and forbids native form submission", async () => {
  const connection = connectHtmlView(iframe, {
    source: "template",
    runtime: "runtime",
    loadEngine,
    allowedOrigins: ["https://cdn.jsdelivr.net"],
  });
  await Promise.resolve();
  expect(sdk.createHtmlViewDocument).toHaveBeenCalledWith(
    expect.objectContaining({ allowedOrigins: ["https://cdn.jsdelivr.net"] }),
  );
  expect(iframe.srcdoc).toContain("form-action 'none'");
  connection.dispose();
});
it("does not navigate a disposed StrictMode effect", async () => {
  const connection = connectHtmlView(iframe, {
    source: "template",
    runtime: "runtime",
    loadEngine,
  });
  connection.dispose();
  await Promise.resolve();
  expect(iframe.srcdoc).toBe("");
});
it("propagates pending edits and failed flush, then releases the host once", async () => {
  const connection = connectHtmlView(iframe, {
    source: "template",
    runtime: "runtime",
    loadEngine,
  });
  message();
  sdk.host.hasPendingChanges.mockReturnValue(true);
  expect(connection.hasPendingChanges()).toBe(true);
  sdk.host.flush.mockRejectedValue(new Error("offline"));
  await expect(connection.flush()).rejects.toThrow("offline");
  expect(sdk.host.dispose).not.toHaveBeenCalled();
  connection.dispose();
  connection.dispose();
  expect(sdk.host.dispose).toHaveBeenCalledOnce();
});
