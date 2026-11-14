// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { checkHtmlViewDraft, HtmlViewRenderCheckHost } from "./render-check-host";
import { RENDER_CHECK_CHANNEL, RENDER_CHECK_TIMEOUT_MS, type HtmlViewRenderCheck } from "./render-check";

const controls = vi.hoisted(() => ({ loaded: true, fetch: vi.fn(), disposed: vi.fn() }));
vi.mock("./drafts/draft-queries", () => ({ draftContentQueryOptions: (draftId: string) => ({
  queryKey: [draftId], queryFn: ({ signal }: { signal: AbortSignal }) => controls.fetch(signal), retry: false,
}) }));
vi.mock("./html-view", () => ({ HtmlView: ({ draft, onSourceLoaded }: { draft: boolean; onSourceLoaded: (id: string) => void }) => {
  expect(draft).toBe(true);
  useEffect(() => { if (controls.loaded) onSourceLoaded("unit"); return controls.disposed; }, [onSourceLoaded]);
  return createElement("iframe");
} }));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  controls.loaded = true;
  controls.fetch.mockReset().mockResolvedValue('<html><head></head><body><p data-univer-cell-text="unit:sheet:A1"></p></body></html>');
  controls.disposed.mockClear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queries = new QueryClient();
  await act(async () => root.render(createElement(QueryClientProvider, { client: queries }, createElement(HtmlViewRenderCheckHost))));
  return {
    async start(signal?: AbortSignal) {
      let result: Promise<HtmlViewRenderCheck> | undefined;
      await act(async () => { result = checkHtmlViewDraft("draft", signal); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      expect(document.querySelector("[data-html-render-check]")?.getAttribute("aria-hidden")).toBe("true");
      expect(document.querySelector("[data-html-render-check]")?.hasAttribute("inert")).toBe(true);
      return { result: result! };
    },
    async report(overrides: Record<string, unknown> = {}, trusted = true) {
      const host = document.querySelector("[data-html-render-check]");
      const frame = host?.querySelector("iframe");
      expect(frame).toBeTruthy();
      await act(async () => window.dispatchEvent(new MessageEvent("message", {
        origin: "null", source: trusted ? frame!.contentWindow : window,
        data: { channel: RENDER_CHECK_CHANNEL, nonce: host!.getAttribute("data-html-render-check"), issues: [], loaded: true,
          quietMs: 1200, elapsedMs: 1500, ...overrides },
      })));
    },
    async close() { await act(async () => root.unmount()); queries.clear(); container.remove(); },
  };
}

it("waits for live sources, rejects foreign frames and nonces, then disposes a passed check", async () => {
  const test = await setup();
  try {
    const { result } = await test.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await test.report({}, false);
    await test.report({ nonce: "foreign-check" });
    expect(document.querySelector("[data-html-render-check]")).not.toBeNull();
    await test.report();
    await expect(result).resolves.toMatchObject({ status: "passed", issues: [] });
    expect(document.querySelector("[data-html-render-check]")).toBeNull();
    expect(controls.disposed).toHaveBeenCalledOnce();
  } finally { await test.close(); }
});

it("does not pass a quiet page before its bound source loads", async () => {
  const test = await setup();
  controls.loaded = false;
  try {
    const { result } = await test.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await test.report();
    expect(document.querySelector("[data-html-render-check]")).not.toBeNull();
    await test.report({ elapsedMs: 8000 });
    await expect(result).resolves.toMatchObject({ status: "timed-out", issues: [] });
  } finally { await test.close(); }
});

it("keeps collected issues when settling times out and unmounts the viewer", async () => {
  const test = await setup();
  try {
    const { result } = await test.start();
    await test.report({ loaded: false, issues: [{ kind: "page-error", message: "  B7 must contain a start month  " }] });
    await test.report({ quietMs: 0, elapsedMs: 8000 });
    await expect(result).resolves.toMatchObject({ status: "timed-out", issues: [{ kind: "page-error", message: "B7 must contain a start month" }] });
    expect(controls.disposed).toHaveBeenCalledOnce();
  } finally { await test.close(); }
});

it("aborts and disposes the viewer when the tool signal is aborted", async () => {
  const test = await setup();
  const controller = new AbortController();
  try {
    const { result } = await test.start(controller.signal);
    await act(async () => controller.abort());
    await expect(result).resolves.toMatchObject({ status: "failed", reason: "Render check was aborted." });
    expect(document.querySelector("[data-html-render-check]")).toBeNull();
    expect(controls.disposed).toHaveBeenCalledOnce();
  } finally { await test.close(); }
});

it("times out an unfinished content fetch and cancels it", async () => {
  const test = await setup();
  let fetchSignal: AbortSignal | undefined;
  controls.fetch.mockImplementation((signal: AbortSignal) => { fetchSignal = signal; return new Promise(() => {}); });
  try {
    vi.useFakeTimers();
    let result: Promise<HtmlViewRenderCheck> | undefined;
    await act(async () => { result = checkHtmlViewDraft("draft"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(RENDER_CHECK_TIMEOUT_MS); });
    await expect(result).resolves.toMatchObject({ status: "timed-out", durationMs: RENDER_CHECK_TIMEOUT_MS });
    expect(fetchSignal?.aborted).toBe(true);
    expect(document.querySelector("[data-html-render-check]")).toBeNull();
  } finally { await test.close(); }
});
