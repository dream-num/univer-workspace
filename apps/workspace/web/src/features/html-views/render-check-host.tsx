import { Component, lazy, Suspense, useEffect, useMemo, useRef, useSyncExternalStore, type PropsWithChildren } from "react";
import { createPortal, flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { getHtmlViewUnitIds, parseHtmlView } from "@univerjs-labs/html-view";
import { z } from "zod";
import { draftContentQueryOptions } from "./drafts/draft-queries";
import { findHtmlFrame } from "./native-preview-protocol";
import {
  inlineRenderErrors, mergeRenderIssues, renderIssueSchema, withRenderCheckClient,
  RENDER_CHECK_CHANNEL, RENDER_CHECK_QUIET_MS, RENDER_CHECK_SETTLE_MS, RENDER_CHECK_TIMEOUT_MS,
  type CheckHtmlViewDraft, type HtmlViewRenderCheck, type HtmlViewRenderIssue,
} from "./render-check";

const HtmlView = lazy(() => import("./html-view").then((module) => ({ default: module.HtmlView })));
interface Request {
  id: string;
  draftId: string;
  issues: HtmlViewRenderIssue[];
  finish(status: HtmlViewRenderCheck["status"], reason?: string): void;
}
let requests: Request[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => requests;
let mounted = 0;

export const checkHtmlViewDraft: CheckHtmlViewDraft = (draftId, signal) => new Promise((resolve) => {
  const startedAt = performance.now();
  const request: Request = { id: crypto.randomUUID(), draftId, issues: [], finish };
  let finished = false;
  const timer = setTimeout(() => finish("timed-out", "Render check exceeded 20 seconds."), RENDER_CHECK_TIMEOUT_MS);
  const abort = () => finish("failed", "Render check was aborted.");
  function finish(status: HtmlViewRenderCheck["status"], reason?: string) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    requests = requests.filter((item) => item !== request);
    flushSync(() => listeners.forEach((listener) => listener()));
    resolve({ status, issues: request.issues, durationMs: Math.round(performance.now() - startedAt), ...(reason ? { reason: reason.slice(0, 300) } : {}) });
  }
  if (signal?.aborted) { abort(); return; }
  if (!mounted) { finish("failed", "HTML View render host is unavailable."); return; }
  signal?.addEventListener("abort", abort, { once: true });
  requests = [...requests, request];
  listeners.forEach((listener) => listener());
});

class CheckBoundary extends Component<PropsWithChildren<{ request: Request }>, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { queueMicrotask(() => this.props.request.finish("failed", error.message)); }
  override render() { return this.state.failed ? null : this.props.children; }
}

const reportSchema = z.object({
  channel: z.literal(RENDER_CHECK_CHANNEL), nonce: z.string(), issues: z.array(renderIssueSchema).max(10),
  loaded: z.boolean(), quietMs: z.number().finite().nonnegative(), elapsedMs: z.number().finite().nonnegative(),
});

function DraftCheck({ request }: { request: Request }) {
  const content = useQuery(draftContentQueryOptions(request.draftId));
  const source = useMemo(() => content.data === undefined ? null : withRenderCheckClient(content.data, request.id), [content.data, request.id]);
  const expected = useMemo(() => content.data === undefined ? [] : getHtmlViewUnitIds(parseHtmlView(content.data)), [content.data]);
  const root = useRef<HTMLDivElement>(null);
  const sources = useRef(new Set<string>());
  const readyAt = useRef(performance.now());
  const sourceLoaded = useMemo(() => (id: string) => { sources.current.add(id); readyAt.current = performance.now(); }, []);
  useEffect(() => {
    if (content.error) queueMicrotask(() => request.finish("failed", content.error.message));
  }, [content.error, request]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const frame = findHtmlFrame(root.current);
      if (!frame || event.source !== frame.contentWindow || event.origin !== "null") return;
      const parsed = reportSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.nonce !== request.id) return;
      const report = parsed.data;
      const viewerIssues = root.current ? inlineRenderErrors(root.current, '[role="alert"]').map((message) => ({ kind: "viewer-error" as const, message })) : [];
      request.issues = mergeRenderIssues(request.issues, [...viewerIssues, ...report.issues]);
      if (!report.loaded) return;
      if ((expected.every((id) => sources.current.has(id)) || viewerIssues.length) &&
          report.quietMs >= RENDER_CHECK_QUIET_MS && performance.now() - readyAt.current >= RENDER_CHECK_QUIET_MS) {
        request.finish(request.issues.length ? "issues" : "passed");
      } else if (report.elapsedMs >= RENDER_CHECK_SETTLE_MS) {
        request.finish("timed-out", "Page did not settle within 8 seconds after load.");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [request, expected]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!root.current) return;
      request.issues = mergeRenderIssues(request.issues, inlineRenderErrors(root.current, '[role="alert"]').map((message) => ({ kind: "viewer-error", message })));
    }, 250);
    return () => clearInterval(timer);
  }, [request]);
  return <div ref={root} aria-hidden="true" inert data-html-render-check={request.id}
    style={{ position: "fixed", left: -10000, top: 0, width: 1280, height: 800, pointerEvents: "none" }}>
    {source !== null && <Suspense fallback={null}>
      <HtmlView source={source} immersive actionsContainer={null} draft onSourceLoaded={sourceLoaded} />
    </Suspense>}
  </div>;
}

export function HtmlViewRenderCheckHost({ children }: PropsWithChildren) {
  const pending = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    mounted++;
    return () => { mounted--; for (const request of requests) queueMicrotask(() => request.finish("failed", "HTML View render host was unmounted.")); };
  }, []);
  return <>{children}{pending.map((request) => createPortal(
    <CheckBoundary key={request.id} request={request}><DraftCheck request={request} /></CheckBoundary>, document.body,
  ))}</>;
}
