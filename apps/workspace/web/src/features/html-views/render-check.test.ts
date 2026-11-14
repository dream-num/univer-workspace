// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { inlineRenderErrors, mergeRenderIssues, RENDER_ERROR_SELECTOR, withRenderCheckClient } from "./render-check";

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
