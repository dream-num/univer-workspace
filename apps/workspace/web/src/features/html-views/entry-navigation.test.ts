import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectEntryNavigation, isSameHtmlEntry, withEntryNavigation } from "./entry-navigation";

const channel = "workspace-html-entry-v1";
afterEach(() => vi.unstubAllGlobals());

function client(loading = false) {
  let script = "";
  vi.stubGlobal(
    "DOMParser",
    class {
      parseFromString() {
        return {
          createElement: () => ({ textContent: "" }),
          head: {
            prepend: (element: { textContent: string }) => {
              script = element.textContent;
            },
          },
          documentElement: { outerHTML: "<html></html>" },
        };
      }
    },
  );
  withEntryNavigation("<html></html>", "generation", "https://workspace.example");
  const listeners = new Map<string, (event: unknown) => void>();
  const parent = { postMessage: vi.fn() };
  const link = { setAttribute: vi.fn(), click: vi.fn(), remove: vi.fn() };
  const body = { append: vi.fn() };
  const dispatchEvent = vi.fn((_event: Event) => true);
  runInNewContext(script, {
    URL,
    CustomEvent,
    parent,
    dispatchEvent,
    document: {
      readyState: loading ? "loading" : "complete",
      baseURI: "https://workspace.example/nodes/app?view=immersive#home",
      body,
      createElement: () => link,
    },
    addEventListener: (name: string, receive: (event: unknown) => void) =>
      listeners.set(name, receive),
  });
  const navigate = (
    patch: Record<string, unknown> = {},
    envelope: Record<string, unknown> = {},
  ) => {
    listeners.get("message")!({
      source: parent,
      origin: "https://workspace.example",
      ...envelope,
      data: {
        channel,
        nonce: "generation",
        action: "navigate",
        search: "?view=immersive",
        hash: "#refundFaq",
        ...patch,
      },
    });
  };
  return { navigate, parent, link, body, dispatchEvent, listeners };
}

describe("sandbox entry navigation", () => {
  it("waits for the template parser and deferred initialization before announcing readiness", () => {
    const page = client(true);
    expect(page.parent.postMessage).not.toHaveBeenCalled();
    // A parent only sends its latest entry after this handshake, so earlier route changes queue.
    page.dispatchEvent.mockReturnValue(false);
    page.listeners.get("DOMContentLoaded")!({});
    expect(page.parent.postMessage).toHaveBeenCalledWith(
      { channel, nonce: "generation", action: "ready" },
      "https://workspace.example",
    );
    page.navigate({ search: "?prd=15", hash: "" });
    expect(page.dispatchEvent).toHaveBeenCalledOnce();
    expect(page.link.click).not.toHaveBeenCalled();
  });
  it("updates a legacy hash router after creation, without recreating its state", () => {
    const page = client();
    expect(page.parent.postMessage).toHaveBeenCalledWith(
      { channel, nonce: "generation", action: "ready" },
      "https://workspace.example",
    );
    page.navigate();
    expect(page.link.setAttribute).toHaveBeenCalledWith("href", "#refundFaq");
    expect(page.link.click).toHaveBeenCalledOnce();
    expect(page.link.remove).toHaveBeenCalledOnce();
    expect(page.dispatchEvent.mock.calls[0]![0]).toMatchObject({
      type: "workspace-location-change",
      detail: { hash: "#refundFaq" },
    });
    // A view-mode/query change must not reset an older App's working hash to #home.
    page.navigate({ search: "?prd=13" });
    expect(page.link.click).toHaveBeenCalledOnce();
  });
  it("lets an entry-aware App handle query scenes and repeated entries", () => {
    const page = client();
    page.dispatchEvent.mockReturnValue(false);
    page.navigate({ search: "?view=immersive&prd=13", hash: "" });
    page.navigate({ search: "?view=immersive&prd=15", hash: "" });
    page.navigate({ search: "?view=immersive&prd=15", hash: "" });
    expect(page.dispatchEvent).toHaveBeenCalledTimes(3);
    expect(page.link.click).not.toHaveBeenCalled();
    expect(page.dispatchEvent.mock.calls.at(-1)![0]).toMatchObject({
      cancelable: true,
      detail: { search: "?view=immersive&prd=15", hash: "" },
    });
  });
  it("rejects other windows, origins, generations and malformed payloads", () => {
    const page = client();
    page.navigate({}, { source: {} });
    page.navigate({}, { origin: "https://untrusted.example" });
    for (const patch of [
      { nonce: "old" },
      { channel: "other" },
      { action: "execute" },
      { hash: "javascript:alert(1)" },
      { search: {} },
      { hash: "#".repeat(8193) },
    ])
      page.navigate(patch);
    expect(page.dispatchEvent).not.toHaveBeenCalled();
    expect(page.body.append).not.toHaveBeenCalled();
  });
  it("sends current entries only to the ready current frame and releases listeners", () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const host = {
      location: { search: "?view=immersive", hash: "#home" },
      addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
      removeEventListener: vi.fn(),
    };
    const target = { postMessage: vi.fn() };
    const frame = { contentWindow: target } as unknown as HTMLIFrameElement;
    const connection = connectEntryNavigation(host as unknown as Window, () => frame, "generation");
    connection.send();
    host.location.hash = "#refundFaq";
    connection.send();
    expect(target.postMessage).not.toHaveBeenCalled();
    const ready = {
      source: target,
      origin: "null",
      data: { channel, nonce: "generation", action: "ready" },
    };
    listeners.get("message")!({ ...ready, source: {} });
    listeners.get("message")!({ ...ready, origin: "https://other.example" });
    expect(target.postMessage).not.toHaveBeenCalled();
    listeners.get("message")!(ready);
    host.location.hash = "#refundFaq";
    listeners.get("hashchange")!({});
    host.location.search = "?prd=13";
    listeners.get("popstate")!({});
    expect(target.postMessage).toHaveBeenLastCalledWith(
      { channel, nonce: "generation", action: "navigate", search: "?prd=13", hash: "#refundFaq" },
      "*",
    );
    connection.dispose();
    connection.send();
    expect(host.removeEventListener).toHaveBeenCalledTimes(3);
    expect(target.postMessage).toHaveBeenCalledTimes(3);
  });
  it("bypasses the departure pause only while the HTML resource identity is unchanged", () => {
    const node = { pathname: "/nodes/a", search: { view: "immersive" } };
    expect(isSameHtmlEntry(node, { ...node, search: { ...node.search, prd: "13" } })).toBe(true);
    expect(isSameHtmlEntry(node, { ...node, pathname: "/nodes/b" })).toBe(false);
    expect(isSameHtmlEntry(node, { ...node, search: { unit: "different" } })).toBe(false);
    const bySpace = { pathname: "/apps", search: { spaceId: "a" } };
    expect(isSameHtmlEntry(bySpace, { ...bySpace, search: { spaceId: "b" } })).toBe(false);
    const app = { pathname: "/apps", search: { node: "a" } };
    expect(isSameHtmlEntry(app, { ...app, search: { node: "b" } })).toBe(false);
    expect(
      isSameHtmlEntry({ ...node, pathname: "/settings" }, { ...node, pathname: "/settings" }),
    ).toBe(false);
  });
});
