// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HtmlView, HtmlViewFile } from "../html-view";
import { LanguageProvider } from "../../../shared/i18n";
import { HtmlViewDraftReview } from "./draft-review";
import type { HtmlViewDraft } from "./draft-queries";

const preview = vi.hoisted(() => {
  const NativeRequest = globalThis.Request;
  // Node's Request needs the browser's relative-URL resolution before api initializes.
  vi.stubGlobal("Request", class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return { html: vi.fn(), file: vi.fn(), fetch };
});
vi.mock("../html-view", () => ({
  HtmlView: (props: ComponentProps<typeof HtmlView>) => {
    preview.html(props);
    return createElement("div", { "data-preview": "new" }, props.source);
  },
  HtmlViewFile: (props: ComponentProps<typeof HtmlViewFile>) => {
    preview.file(props);
    return createElement("div", { "data-preview": "current" }, props.resource.contentUrl);
  },
}));

let draft: HtmlViewDraft;
let html: string;
let container: HTMLDivElement;
let root: Root;
let queries: QueryClient;
let publishStatus: number;
let publishMessage: string;
let rejectStatus: number;
let rejectWait: Promise<void> | undefined;
let notFound: boolean;
const requests: Request[] = [];
const NativeRequest = globalThis.Request;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.setItem("univer-workspace-language", "en-US");
  vi.clearAllMocks(); requests.length = 0;
  draft = {
    id: "draft-1", kind: "create", state: "pending", spaceId: "sales", parentNodeId: "folder-1",
    name: "Sales.univer.html", targetResourceId: null, baseEtag: null, byteSize: 100,
    createdAt: "2026-11-12T00:00:00Z", expiresAt: "2026-11-19T00:00:00Z", decidedAt: null, published: null,
  };
  html = "<!doctype html><html><body>New draft</body></html>";
  publishStatus = 200; rejectStatus = 200; publishMessage = "The page changed."; notFound = false;
  rejectWait = undefined;
  vi.stubGlobal("fetch", preview.fetch);
  preview.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof NativeRequest ? input : new Request(input, init);
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/content")) return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (path.endsWith("/publish")) {
      if (publishStatus === 409) draft = { ...draft, state: "conflicted" };
      if (publishStatus !== 200) return Response.json({ error: { code: "CONFLICT", message: publishMessage } }, { status: publishStatus });
      draft = { ...draft, state: "published", published: { nodeId: "page-node", resourceId: "page-resource", etag: '"v2"' } };
    }
    if (path.endsWith("/reject")) {
      await rejectWait;
      if (rejectStatus !== 200) return Response.json({ error: { message: "Interactive session required." } }, { status: rejectStatus });
      draft = { ...draft, state: "rejected" };
    }
    if (path.startsWith("/api/html-view-drafts/")) return notFound ? Response.json({ error: { message: "Missing" } }, { status: 404 }) : Response.json({ draft });
    if (path === "/api/spaces/sales") return Response.json({ fullName: "alice/sales", publicRead: false });
    if (path === "/api/nodes/folder-1") return Response.json({ node: { name: "Reports" } });
    if (path === "/api/nodes/media-1") return Response.json({ node: { resource: { id: "media-resource", kind: "blob", availability: "ready", mediaType: "image/png" } } });
    if (path === "/api/resources/old-page/open") return Response.json({ resource: { kind: "blob", contentUrl: "/current.html", byteSize: 80 } });
    throw new Error(`Unexpected request ${request.method} ${path}`);
  });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queries.clear(); container.remove(); vi.unstubAllGlobals();
});

async function render(presentation: "page" | "card" = "page", props: Partial<ComponentProps<typeof HtmlViewDraftReview>> = {}) {
  await act(async () => root.render(createElement(LanguageProvider, null,
    createElement(QueryClientProvider, { client: queries }, createElement(HtmlViewDraftReview, { draftId: draft.id, presentation, ...props })))));
}
async function waitFor(check: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    try { check(); return; } catch (error) { if (attempt === 99) throw error; }
  }
}
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
function count(suffix: string) { return requests.filter((request) => new URL(request.url).pathname.endsWith(suffix)).length; }
async function reason(value: string) {
  const input = container.querySelector("textarea");
  if (!input) throw new Error("Missing change reason");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["en-US", "zh-CN"])("hides all decisions for a replaced pending draft in %s", async (language) => {
  window.localStorage.setItem("univer-workspace-language", language);
  await render("card", { replaced: true, onRequestChanges: vi.fn() });
  await waitFor(() => expect(container.textContent).toContain(language === "en-US" ? "A newer draft replaced this one" : "已有更新的草稿"));
  expect(container.querySelector("button")).toBeNull();
  expect(count("/content")).toBe(0);
});

it.each(["published", "rejected", "expired", "conflicted"] as const)("keeps a replaced %s draft's existing terminal display", async (state) => {
  draft = { ...draft, state };
  await render("card", { replaced: true, onRequestChanges: vi.fn() });
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  expect(container.textContent).not.toContain("A newer draft replaced this one");
  expect(container.textContent).toContain(state === "conflicted" ? "The page changed" : state[0]!.toUpperCase() + state.slice(1));
  expect(container.querySelector("button")).toBeNull();
});

it("labels the change reason and disables Send for blank input or a running session", async () => {
  const onRequestChanges = vi.fn();
  await render("card", { onRequestChanges });
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  await click("Request changes");
  expect(container.querySelector("label")?.textContent).toBe("What should change?");
  expect(button("Send").disabled).toBe(true);
  await reason("   "); expect(button("Send").disabled).toBe(true);
  await reason("Make the chart larger"); expect(button("Send").disabled).toBe(false);
  await render("card", { onRequestChanges, requestChangesDisabled: true });
  expect(button("Send").disabled).toBe(true);
  await click("Send");
  expect(count("/reject")).toBe(0); expect(onRequestChanges).not.toHaveBeenCalled();
});

it.each(["en-US", "zh-CN"])("rejects before sending the localized change request in %s", async (language) => {
  window.localStorage.setItem("univer-workspace-language", language);
  let finishReject!: () => void;
  rejectWait = new Promise<void>((resolve) => { finishReject = resolve; });
  const onRequestChanges = vi.fn(() => { expect(draft.state).toBe("rejected"); });
  await render("card", { onRequestChanges });
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  await click(language === "en-US" ? "Request changes" : "要求修改");
  await reason("  Make the chart larger  ");
  const send = language === "en-US" ? "Send" : "发送";
  await click(send);
  await waitFor(() => expect(button(send).disabled).toBe(true));
  expect(onRequestChanges).not.toHaveBeenCalled();
  await act(async () => finishReject());
  await waitFor(() => expect(onRequestChanges).toHaveBeenCalledExactlyOnceWith(language === "en-US"
    ? "Revise draft “Sales.univer.html”: Make the chart larger" : "修改草稿「Sales.univer.html」：Make the chart larger"));
  expect(count("/reject")).toBe(1);
  expect(requests.find((request) => request.url.endsWith("/reject"))?.method).toBe("POST");
});

it("shows rejection failure on the card without sending or losing the reason", async () => {
  rejectStatus = 403;
  const onRequestChanges = vi.fn();
  await render("card", { onRequestChanges });
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  await click("Request changes"); await reason("Change the colors"); await click("Send");
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("Interactive session required."));
  expect(onRequestChanges).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")?.value).toBe("Change the colors");
  expect(button("Send").disabled).toBe(false);
});

it("returns from full-screen preview to the card's change form", async () => {
  await render("card", { onRequestChanges: vi.fn() });
  await waitFor(() => expect(button("Open draft preview").disabled).toBe(false));
  await click("Open draft preview");
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  const action = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Request changes");
  expect(action).toBeDefined();
  await act(async () => action!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector("textarea")).not.toBeNull();
});

it("offers no Request changes on the standalone draft page", async () => {
  await render("page", { onRequestChanges: vi.fn() });
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  expect(container.textContent).not.toContain("Request changes");
});

it("shows a create draft and destination, publishes once, and links to the immersive page", async () => {
  await render();
  await waitFor(() => expect(container.textContent).toContain("Reports"));
  expect(container.textContent).toContain("Sales.univer.html");
  expect(container.textContent).toContain("alice/sales");
  expect(button("Publish").disabled).toBe(false);
  await waitFor(() => expect(preview.html).toHaveBeenCalled());
  expect(preview.html.mock.lastCall?.[0]).toMatchObject({ source: html, draft: true, immersive: true });
  await click("Publish");
  await waitFor(() => expect(container.textContent).toContain("Published"));
  expect(count("/publish")).toBe(1);
  expect(requests.find((request) => request.url.endsWith("/publish"))?.method).toBe("POST");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/nodes/page-node?view=immersive");
  expect(container.querySelector("a")?.textContent).toBe("Open page");
});

it("rejects a pending draft and shows the rejected state", async () => {
  await render();
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  await click("Reject");
  await waitFor(() => expect(container.textContent).toContain("Rejected"));
  expect(count("/reject")).toBe(1);
  expect(requests.find((request) => request.url.endsWith("/reject"))?.method).toBe("POST");
  expect(container.querySelector("button")).toBeNull();
});

it("compares New and Current with both sides in draft mode", async () => {
  draft = { ...draft, kind: "replace", targetResourceId: "old-page", baseEtag: '"v1"' };
  await render();
  await waitFor(() => expect(preview.html).toHaveBeenCalled());
  expect(button("New").getAttribute("aria-pressed")).toBe("true");
  await click("Current");
  await waitFor(() => expect(preview.file).toHaveBeenCalled());
  expect(preview.file.mock.lastCall?.[0]).toMatchObject({ resource: { contentUrl: "/current.html" }, draft: true });
  expect(button("Current").getAttribute("aria-pressed")).toBe("true");
  await click("New");
  expect(container.querySelector('[data-preview="new"]')).not.toBeNull();
});

it.each(["conflicted", "expired", "rejected", "published"] as const)("shows %s without fetching content or offering Publish", async (state) => {
  draft = { ...draft, state };
  await render();
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  expect(container.textContent).toContain(state === "conflicted" ? "The page changed since the Agent drafted it" : state[0]!.toUpperCase() + state.slice(1));
  expect(container.querySelector("button")).toBeNull();
  expect(count("/content")).toBe(0);
  expect(preview.html).not.toHaveBeenCalled();
});

it("shows a not-found message for a 404", async () => {
  notFound = true;
  await render();
  await waitFor(() => expect(container.textContent).toContain("Draft not found or not yours."));
  expect(count("/content")).toBe(0);
});

it("refetches the draft after a publish conflict and removes Publish", async () => {
  publishStatus = 409;
  await render();
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  await click("Publish");
  await waitFor(() => expect(container.textContent).toContain("Ask the Agent to revise it."));
  expect(count("/draft-1")).toBe(2);
  expect(container.querySelector("button")).toBeNull();
});

it.each(["Publish", "Reject"])("shows the server message on a forbidden %s", async (action) => {
  if (action === "Publish") { publishStatus = 403; publishMessage = "Interactive session required."; }
  else rejectStatus = 403;
  await render();
  await waitFor(() => expect(container.textContent).toContain("Sales.univer.html"));
  await click(action);
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("Interactive session required."));
});

it("requires opening the full-screen preview before card publication", async () => {
  await render("card");
  await waitFor(() => expect(button("Open draft preview").disabled).toBe(false));
  expect(button("Publish").disabled).toBe(true);
  expect(preview.html).not.toHaveBeenCalled();
  await click("Open draft preview");
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  expect(button("Publish").disabled).toBe(false);
  await click("Back");
  expect(button("Publish").disabled).toBe(false);
  await click("Publish");
  await waitFor(() => expect(container.textContent).toContain("Open page"));
});

it("resolves Workspace media before passing the New source to HtmlView", async () => {
  html = '<!doctype html><html><body><img data-workspace-src="media-1"></body></html>';
  await render();
  await waitFor(() => expect(preview.html).toHaveBeenCalled());
  expect(preview.html.mock.lastCall?.[0].source).toContain('/api/blob-resources/media-resource/content');
  expect(requests.find((request) => request.url.endsWith("/media-1"))?.credentials).toBe("omit");
});

it("closes the card preview and shows a failed publication message", async () => {
  publishStatus = 403; publishMessage = "Interactive session required.";
  await render("card");
  await waitFor(() => expect(button("Open draft preview").disabled).toBe(false));
  await click("Open draft preview");
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  await click("Publish");
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe(publishMessage));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("uses Chinese review strings when Chinese is selected", async () => {
  window.localStorage.setItem("univer-workspace-language", "zh-CN");
  await render();
  await waitFor(() => expect(container.textContent).toContain("等待审阅"));
  expect(button("发布").disabled).toBe(false);
  expect(container.textContent).toContain("目标位置");
});
