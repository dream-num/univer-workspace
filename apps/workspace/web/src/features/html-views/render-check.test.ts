// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { inlineRenderErrors, leftoverPlaceholders, mergeRenderIssues, PLACEHOLDER_PATTERN, RENDER_ERROR_SELECTOR, renderCheckVerdict, withRenderCheckClient } from "./render-check";

it("trims to 300 characters, deduplicates by message, drops empty issues and caps at 10", () => {
  const result = mergeRenderIssues([{ kind: "uncaught-error", message: "  failure  " }], [
    { kind: "console-error", message: "failure" }, { kind: "page-error", message: "  " },
    ...Array.from({ length: 20 }, (_, i) => ({ kind: "page-error" as const, message: `${i}${"x".repeat(400)} ` })),
  ]);
  expect(result).toHaveLength(10);
  expect(result[0]).toEqual({ kind: "uncaught-error", message: "failure" });
  expect(result.slice(1).every((issue) => issue.message.length === 300)).toBe(true);
});

it("reads all template error markers without reporting idle, saved, empty, or hidden status text", () => {
  document.body.innerHTML = `<p role="status">Synced with Sheet</p><p data-s="saved">Saved</p>
    <p data-s="rejected">Bad month</p><p role="alert">Load failed</p><p data-s="error">Write failed</p>
    <p data-error="true">Could not load</p><p role="status" class="bad">No access</p>
    <section data-univer-range-subscribe="unit:sheet:A1:B2">Could not load: Invalid due date</section>
    <section data-univer-range-subscribe="unit:sheet:A1:B2">Acme · In progress</section>
    <p hidden role="alert">Hidden</p><section style="display:none"><p role="alert">Hidden parent</p></section>
    <p role="alert"></p><p data-s="empty">No monthly data</p>`;
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  expect(inlineRenderErrors(document, RENDER_ERROR_SELECTOR)).toEqual(["Bad month", "Load failed", "Write failed", "Could not load", "No access", "Could not load: Invalid due date"]);
  vi.restoreAllMocks();
});

it("instruments only the rendered copy at the start of head and keeps its page scripts", () => {
  const source = '<!doctype html><html><head><title>Draft</title></head><body><script>console.error("broken")</script></body></html>';
  const rendered = new DOMParser().parseFromString(withRenderCheckClient(source, "test-nonce"), "text/html");
  expect(rendered.head.firstElementChild?.tagName).toBe("SCRIPT");
  expect(rendered.head.firstElementChild?.textContent).toContain("test-nonce");
  expect(rendered.body.querySelector("script")?.textContent).toBe('console.error("broken")');
  expect(source).not.toContain("test-nonce");
});

it("runs the injected listeners and captures runtime errors as bounded text", () => {
  const source = withRenderCheckClient('<html><head></head><body></body></html>', "test-nonce");
  const rendered = new DOMParser().parseFromString(source, "text/html");
  const script = rendered.head.querySelector("script")!.textContent!;
  const added = vi.spyOn(window, "addEventListener");
  const reports = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    window.eval(script);
    console.error("Console failure", { code: 4 });
    window.dispatchEvent(new ErrorEvent("error", { message: "Uncaught failure" }));
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("Rejected promise") }));
    expect(reports.mock.calls.at(-1)?.[0]).toMatchObject({ nonce: "test-nonce", issues: [
      { kind: "console-error", message: 'Console failure {"code":4}' },
      { kind: "uncaught-error", message: "Uncaught failure" },
      { kind: "unhandled-rejection", message: "Rejected promise" },
    ] });
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    for (const [type, listener, options] of added.mock.calls) window.removeEventListener(type, listener, options);
    vi.restoreAllMocks();
  }
});

it("lists visible leftover loading text and filler once data should have arrived, and nothing else", () => {
  document.body.innerHTML = `<p>Loading…</p><p>加载中，请稍候</p><span>...</span><div><p>Lorem ipsum dolor sit amet</p></div>
    <p>Loading rate is 5 percent per hour across all of the regions in the table</p><p hidden>Loading hidden</p>
    <section style="display:none"><p>加载中</p></section><p>Revenue: 42</p><p>Loading… <b>12</b></p><button>Todo</button><p>Loading…</p>`;
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  expect(leftoverPlaceholders(document, PLACEHOLDER_PATTERN)).toEqual(["Loading…", "加载中，请稍候", "...", "Lorem ipsum dolor sit amet", "Todo"]);
  vi.restoreAllMocks();
});

it("reaches a verdict only when the page loaded, its sources are ready and it was quiet", () => {
  const base = { loaded: true, sourcesReady: true, hasViewerIssue: false, hasIssues: false, quietMs: 1200, elapsedMs: 2000, sinceReadyMs: 1200 };
  expect(renderCheckVerdict(base)).toBe("passed");
  expect(renderCheckVerdict({ ...base, hasIssues: true })).toBe("issues");
  expect(renderCheckVerdict({ ...base, loaded: false })).toBe("waiting");
  expect(renderCheckVerdict({ ...base, quietMs: 100 })).toBe("waiting");
  expect(renderCheckVerdict({ ...base, sourcesReady: false })).toBe("waiting");
  expect(renderCheckVerdict({ ...base, sourcesReady: false, hasViewerIssue: true, hasIssues: true })).toBe("issues");
  expect(renderCheckVerdict({ ...base, sourcesReady: false, elapsedMs: 9000 })).toBe("timed-out");
});

it("sends visible placeholders from the rendered copy", () => {
  const rendered = withRenderCheckClient("<!doctype html><html><head></head><body><p>Loading…</p></body></html>", "n");
  expect(rendered).toContain("loading");
  expect(rendered).toContain("placeholders");
});
