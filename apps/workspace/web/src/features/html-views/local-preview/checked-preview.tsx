import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HtmlView } from "../html-view";
import { findHtmlFrame } from "../native-preview-protocol";
import {
  inlineRenderErrors, mergeRenderIssues, renderCheckMessageSchema, renderCheckVerdict, withRenderCheckClient,
  RENDER_CHECK_TIMEOUT_MS, type HtmlViewRenderCheck, type HtmlViewRenderIssue,
} from "../render-check";
import type { HtmlViewEngine, HtmlViewSourceWorktree } from "../workspace-binding-engine";
import { engineProbe, sampleBindings } from "./bindings";
import { DiagnosticsPanel, type ReportDelivery } from "./diagnostics-panel";
import { buildReport, type LocalPreviewReport } from "./report";
import type { PreviewPage } from "./use-preview-page";
import type { HtmlViewBinding } from "@univerjs-labs/html-view";

export type PreviewWriteMode = "trial" | "saved";

export interface CheckedPreviewProps {
  page: PreviewPage;
  bindings: readonly HtmlViewBinding[];
  unitIds: readonly string[];
  token: string;
  writeMode: PreviewWriteMode;
  worktree: HtmlViewSourceWorktree | undefined;
  /** Null shows the page at the available width. */
  viewportWidth: number | null;
  /** Resolves to null when there is no host to tell. */
  deliver: (report: LocalPreviewReport) => Promise<boolean | null>;
}

/** One page load in one write mode: render it, check it once it settles, report once. Remount for the next load. */
export function CheckedPreview(props: CheckedPreviewProps) {
  const nonce = useMemo(() => crypto.randomUUID(), []);
  const source = useMemo(() => withRenderCheckClient(props.page.html, nonce), [props.page.html, nonce]);
  const root = useRef<HTMLDivElement>(null);
  const engines = useRef(new Map<string, HtmlViewEngine>());
  const readyAt = useRef(performance.now());
  const latest = useRef(props);
  latest.current = props;
  const [result, setResult] = useState<{ report: LocalPreviewReport; delivery: ReportDelivery } | null>(null);
  const onSourceLoaded = useCallback((unitId: string, engine: HtmlViewEngine) => {
    engines.current.set(unitId, engine);
    readyAt.current = performance.now();
  }, []);

  useEffect(() => {
    const startedAt = performance.now();
    let issues: HtmlViewRenderIssue[] = [];
    let placeholders: string[] = [];
    let done = false;
    const finish = (status: HtmlViewRenderCheck["status"], reason?: string) => {
      if (done) return;
      done = true;
      const current = latest.current;
      const frame = findHtmlFrame(root.current);
      const loaded = [...engines.current.values()];
      const report = buildReport({
        token: current.token,
        sha256: current.page.sha256,
        renderCheck: { status, issues, durationMs: Math.round(performance.now() - startedAt), ...(reason ? { reason } : {}) },
        bindings: sampleBindings(current.bindings, engineProbe(engines.current)),
        leftoverPlaceholders: placeholders,
        viewport: { width: frame?.clientWidth ?? 0, height: frame?.clientHeight ?? 0 },
        writeMode: current.writeMode === "saved" && loaded.length > 0 && loaded.every((engine) => engine.writeMode === "saved") ? "saved" : "trial",
      });
      setResult({ report, delivery: "pending" });
      void current.deliver(report).then((sent) => setResult((now) => now?.report === report ? { report, delivery: sent === null ? "local" : sent ? "sent" : "failed" } : now));
    };
    const timer = setTimeout(() => finish("timed-out", "Render check exceeded 20 seconds."), RENDER_CHECK_TIMEOUT_MS);
    const receive = (event: MessageEvent) => {
      const frame = findHtmlFrame(root.current);
      if (!frame || event.source !== frame.contentWindow || event.origin !== "null") return;
      const parsed = renderCheckMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.nonce !== nonce) return;
      const message = parsed.data;
      const viewerIssues = root.current ? inlineRenderErrors(root.current, '[role="alert"]').map((text) => ({ kind: "viewer-error" as const, message: text })) : [];
      issues = mergeRenderIssues(issues, [...viewerIssues, ...message.issues]);
      placeholders = message.placeholders;
      const verdict = renderCheckVerdict({ loaded: message.loaded, sourcesReady: latest.current.unitIds.every((id) => engines.current.has(id)),
        hasViewerIssue: viewerIssues.length > 0, hasIssues: issues.length > 0, quietMs: message.quietMs, elapsedMs: message.elapsedMs,
        sinceReadyMs: performance.now() - readyAt.current });
      if (verdict === "timed-out") finish("timed-out", "Page did not settle within 8 seconds after load.");
      else if (verdict !== "waiting") finish(verdict);
    };
    window.addEventListener("message", receive);
    return () => { done = true; clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [nonce]);

  return <div className="flex min-h-0 flex-1">
    <div ref={root} className="min-w-0 flex-1 overflow-auto bg-muted/40">
      <div className="mx-auto h-full bg-background" style={props.viewportWidth === null ? { width: "100%" } : { width: props.viewportWidth }}>
        <HtmlView source={source} immersive actionsContainer={null} draft={props.writeMode === "trial"} hideDraftNotice
          sourceWorktree={props.worktree} onSourceLoaded={onSourceLoaded} />
      </div>
    </div>
    <DiagnosticsPanel result={result} />
  </div>;
}
