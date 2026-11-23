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
export const renderCheckMessageSchema = z.object({
  channel: z.literal(RENDER_CHECK_CHANNEL), nonce: z.string(), issues: z.array(renderIssueSchema).max(10),
  loaded: z.boolean(), quietMs: z.number().finite().nonnegative(), elapsedMs: z.number().finite().nonnegative(),
  placeholders: z.array(z.string().max(100)).max(10).default([]),
});

/** Whole-element text that still reads as loading or filler once data has arrived. */
export const PLACEHOLDER_PATTERN = "^(?:loading\\b.{0,40}|…|\\.{3}|加载中.{0,20}|载入中.{0,20}|正在加载.{0,20}|读取中.{0,20}|待加载|待补充|placeholder\\b.{0,40}|占位.{0,20}|lorem ipsum.{0,60}|tbd|todo)$";

/** The verdict both the hidden draft check and the live preview reach from the same sandbox messages. */
export function renderCheckVerdict(input: { loaded: boolean; sourcesReady: boolean; hasViewerIssue: boolean; hasIssues: boolean;
  quietMs: number; elapsedMs: number; sinceReadyMs: number }): HtmlViewRenderCheck["status"] | "waiting" {
  if (!input.loaded) return "waiting";
  if ((input.sourcesReady || input.hasViewerIssue) && input.quietMs >= RENDER_CHECK_QUIET_MS && input.sinceReadyMs >= RENDER_CHECK_QUIET_MS)
    return input.hasIssues ? "issues" : "passed";
  return input.elapsedMs >= RENDER_CHECK_SETTLE_MS ? "timed-out" : "waiting";
}
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

export function leftoverPlaceholders(root: ParentNode, pattern: string): string[] {
  const matcher = new RegExp(pattern, "i");
  const found: string[] = [];
  for (const element of Array.from(root.querySelectorAll("body *"))) {
    const view = element.ownerDocument.defaultView;
    if (!view || element.children.length || element.matches("script, style, noscript, template") || !element.getClientRects().length) continue;
    let visible = true;
    for (let node: Element | null = element; node && visible; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      visible = style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
    }
    const text = element.textContent?.trim().replace(/\s+/g, " ") ?? "";
    if (visible && text && matcher.test(text) && !found.includes(text)) found.push(text);
    if (found.length === 10) break;
  }
  return found;
}

// Serialized into the sandbox. Keep dependencies explicit so only the rendered copy is instrumented.
function renderCheckClient(channel: string, nonce: string, selector: string, readErrors: typeof inlineRenderErrors, merge: typeof mergeRenderIssues,
  readPlaceholders: typeof leftoverPlaceholders, placeholderPattern: string) {
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
    parent.postMessage({ channel, nonce, issues, loaded: loadedAt !== null, placeholders: readPlaceholders(document, placeholderPattern),
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
  script.textContent = `(${renderCheckClient.toString()})(${JSON.stringify(RENDER_CHECK_CHANNEL)},${JSON.stringify(nonce)},${JSON.stringify(RENDER_ERROR_SELECTOR)},${inlineRenderErrors.toString()},${mergeRenderIssues.toString()},${leftoverPlaceholders.toString()},${JSON.stringify(PLACEHOLDER_PATTERN)});`;
  document.head.prepend(script);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
