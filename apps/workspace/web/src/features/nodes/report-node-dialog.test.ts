// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../shared/i18n";
import { ReportNodeDialog } from "./report-node-dialog";

const mocks = vi.hoisted(() => {
  const NativeRequest = globalThis.Request;
  // Node's Request needs the browser's relative-URL resolution before api initializes.
  vi.stubGlobal("Request", class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return { fetch, toast: { success: vi.fn(), error: vi.fn() } };
});
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal<object>()), toast: mocks.toast }));

let container: HTMLDivElement;
let root: Root;
let status: number;
const reports: { path: string; body: unknown }[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.setItem("univer-workspace-language", "en-US");
  vi.clearAllMocks();
  reports.length = 0;
  status = 201;
  mocks.fetch.mockImplementation(async (request: Request) => {
    reports.push({ path: `${request.method} ${new URL(request.url).pathname}`, body: await request.json() });
    return status === 201
      ? Response.json({ id: "report-1" }, { status })
      : Response.json({ error: { code: "REPORT_RATE_LIMITED", message: "Too many reports." } }, { status });
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function ControlledReport() {
  const [open, setOpen] = useState(true);
  return createElement(ReportNodeDialog, { nodeId: "node-1", open, onOpenChange: setOpen });
}

async function render() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => root.render(createElement(LanguageProvider, null,
    createElement(QueryClientProvider, { client }, createElement(ControlledReport)))));
}
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function settle() {
  for (let attempt = 0; attempt < 5; attempt += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}
async function openAndType(reason: string) {
  const input = document.querySelector<HTMLTextAreaElement>("textarea#report-node-reason");
  if (!input) throw new Error("Missing reason");
  expect(document.querySelector('label[for="report-node-reason"]')?.textContent).toContain("Reason");
  expect(button("Send report").disabled).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, reason);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("sends the trimmed reason to the Node's reports endpoint, then closes and confirms", async () => {
  await render();
  await openAndType("  phishing page  ");
  await act(async () => button("Send report").click());
  await settle();

  expect(reports).toEqual([{ path: "POST /api/nodes/node-1/reports", body: { reason: "phishing page" } }]);
  expect(mocks.toast.success).toHaveBeenCalledWith("Report sent. Thank you.");
  expect(document.body.textContent).not.toContain("Report this file");
});

it("keeps the dialog and the reason when the report is refused", async () => {
  status = 429;
  await render();
  await openAndType("spam");
  await act(async () => button("Send report").click());
  await settle();

  expect(reports).toHaveLength(1);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("The report was not sent. Try again later.");
  expect(document.querySelector("textarea")?.value).toBe("spam");
  expect(mocks.toast.success).not.toHaveBeenCalled();
});
