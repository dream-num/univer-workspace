import { z } from "zod";

export const RENDER_CHECK_QUIET_MS = 1_000;
export const RENDER_CHECK_SETTLE_MS = 8_000;
export const RENDER_CHECK_TIMEOUT_MS = 20_000;
export const RENDER_CHECK_CHANNEL = "workspace-html-render-check-v1";
export const RENDER_ERROR_SELECTOR = '[role="alert"], [data-s="rejected"], [data-s="error"], [data-error="true"], [role="status"].bad, [data-univer-range-subscribe]';

export const renderIssueSchema = z.object({
  kind: z.enum(["uncaught-error", "unhandled-rejection", "console-error", "page-error", "viewer-error"]),
  message: z.string(),
});
export type HtmlViewRenderIssue = z.infer<typeof renderIssueSchema>;
export const renderCheckSchema = z.object({
  status: z.enum(["passed", "issues", "timed-out", "failed"]),
  issues: z.array(renderIssueSchema),
  durationMs: z.number(),
  reason: z.string().optional(),
});
export type HtmlViewRenderCheck = z.infer<typeof renderCheckSchema>;
export type CheckHtmlViewDraft = (draftId: string, signal?: AbortSignal) => Promise<HtmlViewRenderCheck>;

export function mergeRenderIssues(previous: readonly HtmlViewRenderIssue[], incoming: readonly HtmlViewRenderIssue[]): HtmlViewRenderIssue[] {
  const issues: HtmlViewRenderIssue[] = [];
  for (const issue of [...previous, ...incoming]) {
    const message = issue.message.trim().slice(0, 300);
    if (!message || issues.some((item) => item.message === message)) continue;
    issues.push({ kind: issue.kind, message });
    if (issues.length === 10) break;
  }
  return issues;
}

export function inlineRenderErrors(root: ParentNode, selector: string): string[] {
  return Array.from(root.querySelectorAll(selector)).flatMap((element) => {
    const view = element.ownerDocument.defaultView;
    if (!view || !element.getClientRects().length) return [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return [];
    }
    const text = element.textContent?.trim();
    // Task and chart templates also put load failures directly in the bound container.
    if (element.matches("[data-univer-range-subscribe]") && !element.matches('[role="alert"], [data-s="rejected"], [data-s="error"]') &&
        !/^(Could not load:|Unable to load (?:data|Sheet)|Chart unavailable\.)/.test(text ?? "")) return [];
    return text ? [text] : [];
  });
}

// Serialized into the sandbox. Keep dependencies explicit so only the rendered copy is instrumented.
function renderCheckClient(channel: string, nonce: string, selector: string, readErrors: typeof inlineRenderErrors, merge: typeof mergeRenderIssues) {
  let issues: HtmlViewRenderIssue[] = [];
  let changedAt = performance.now();
  let loadedAt: number | null = null;
  const text = (value: unknown): string => {
    if (value instanceof Error) return value.message;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  };
  const add = (kind: HtmlViewRenderIssue["kind"], message: string) => {
    issues = merge(issues, [{ kind, message }]);
  };
  const send = () => {
    issues = merge(issues, readErrors(document, selector).map((message) => ({ kind: "page-error", message })));
    parent.postMessage({ channel, nonce, issues, loaded: loadedAt !== null,
      quietMs: performance.now() - changedAt, elapsedMs: loadedAt === null ? 0 : performance.now() - loadedAt }, "*");
  };
  addEventListener("error", (event) => { add("uncaught-error", event.message || "Page resource failed to load."); send(); }, true);
  addEventListener("unhandledrejection", (event) => { add("unhandled-rejection", text(event.reason)); send(); });
  const original = console.error;
  console.error = (...args: unknown[]) => { add("console-error", args.map(text).join(" ")); send(); original.apply(console, args); };
  const observer = new MutationObserver(() => { changedAt = performance.now(); send(); });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  addEventListener("load", () => { loadedAt = changedAt = performance.now(); send(); }, { once: true });
  const timer = setInterval(send, 250);
  addEventListener("pagehide", () => { observer.disconnect(); clearInterval(timer); }, { once: true });
}

export function withRenderCheckClient(source: string, nonce: string): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  const script = document.createElement("script");
  script.textContent = `(${renderCheckClient.toString()})(${JSON.stringify(RENDER_CHECK_CHANNEL)},${JSON.stringify(nonce)},${JSON.stringify(RENDER_ERROR_SELECTOR)},${inlineRenderErrors.toString()},${mergeRenderIssues.toString()});`;
  document.head.prepend(script);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
