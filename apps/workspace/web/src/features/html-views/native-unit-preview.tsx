import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, ExternalLink, X } from "lucide-react";
import { useI18n } from "../../shared/i18n";
import { Button, Dialog } from "../../shared/ui";
import { openNativeUnit } from "../resources";
import { NATIVE_PREVIEW_CHANNEL } from "../editor/preview";
import { withNativePreviewClient } from "./native-preview-client";
import { boundPreviewRect, findHtmlFrame, HTML_PREVIEW_CHANNEL, parsePreviewMessage, type PreviewRequest } from "./native-preview-protocol";

type Opened = Awaited<ReturnType<typeof openNativeUnit>>;

export function useNativeUnitPreview(source: string, identityKey: string) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const viewerRoot = useRef<HTMLDivElement>(null);
  const nativeFrame = useRef<HTMLIFrameElement>(null);
  const nonce = useMemo(() => crypto.randomUUID(), [source, identityKey]);
  const html = useMemo(() => withNativePreviewClient(source, nonce), [source, nonce]);
  const [request, setRequest] = useState<(PreviewRequest & { generation: string }) | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [canDownload, setCanDownload] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "busy" | "error">("idle");
  const downloadRequest = useRef<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const current = useRef(request);
  current.current = request;
  const token = useMemo(() => crypto.randomUUID(), [nonce, request?.unitId]);
  const notify = (action: string, status?: string) => findHtmlFrame(viewerRoot.current)?.contentWindow?.postMessage({
    channel: HTML_PREVIEW_CHANNEL, nonce, action, status, requestId: current.current?.requestId,
  }, "*");
  const close = () => { notify("closed"); setRequest(null); };

  useEffect(() => {
    setRequest(null); setSharing(false);
    const receive = (event: MessageEvent) => {
      const frame = findHtmlFrame(viewerRoot.current);
      // Opaque sandbox origins are not identity. Pin the actual viewer Window and generation.
      if (!frame || event.source !== frame.contentWindow) return;
      const next = parsePreviewMessage(event.data, nonce);
      if (next === "close") setRequest(null);
      else if (next === "share") { setCopyState("idle"); setSharing(true); }
      else if (next && root.current) {
        const rect = boundPreviewRect(next.rect, frame.clientWidth, frame.clientHeight);
        const host = root.current.getBoundingClientRect();
        const content = frame.getBoundingClientRect();
        setRequest({ ...next, generation: nonce, rect: { ...rect, left: rect.left + content.left - host.left,
          top: rect.top + content.top - host.top } });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [nonce]);

  useEffect(() => {
    setOpened(null); setError(false); setReady(false); setMissing(false);
    setCanDownload(false); setDownloadState("idle"); downloadRequest.current = null;
    if (!request || request.generation !== nonce) return;
    const abort = new AbortController();
    void openNativeUnit(request.unitId, abort.signal).then(result => {
      if (!abort.signal.aborted) setOpened(result);
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [nonce, request?.unitId]);

  useEffect(() => {
    if (!opened) return;
    const timeout = setTimeout(() => { if (!ready) setError(true); }, 30_000);
    return () => clearTimeout(timeout);
  }, [opened, ready]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== nativeFrame.current?.contentWindow || event.origin !== location.origin ||
          event.data?.channel !== NATIVE_PREVIEW_CHANNEL || event.data?.token !== token ||
          event.data?.unitId !== current.current?.unitId) return;
      if (event.data.status === "ready") {
        setReady(true); setError(false); setCanDownload(event.data.downloadFormat === "pptx");
      }
      if (event.data.requestId === downloadRequest.current && downloadRequest.current) {
        if (event.data.status === "downloaded" || event.data.status === "download-error") {
          setDownloadState(event.data.status === "downloaded" ? "idle" : "error");
          downloadRequest.current = null;
        }
      }
      if (event.data.requestId === current.current?.requestId &&
          (event.data.status === "located" || event.data.status === "missing")) {
        setMissing(event.data.status === "missing");
        notify("status", event.data.status);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [nonce, token]);

  useEffect(() => {
    setMissing(false);
    if (!ready || !request || opened?.resource.unitId !== request.unitId) return;
    notify("status", "ready");
    if (request.focus) nativeFrame.current?.contentWindow?.postMessage({
      channel: NATIVE_PREVIEW_CHANNEL, token, action: "focus", unitId: request.unitId,
      requestId: request.requestId, focus: request.focus,
    }, location.origin);
  }, [ready, request?.requestId, opened, token]);
  useEffect(() => { if (error) notify("status", "error"); }, [error]);

  useEffect(() => {
    if (downloadState !== "busy") return;
    const timeout = setTimeout(() => {
      downloadRequest.current = null; setDownloadState("error");
    }, 120_000);
    return () => clearTimeout(timeout);
  }, [downloadState]);

  const download = () => {
    if (!ready || !canDownload || downloadState === "busy" || !request) return;
    const requestId = crypto.randomUUID();
    downloadRequest.current = requestId; setDownloadState("busy");
    nativeFrame.current?.contentWindow?.postMessage({ channel: NATIVE_PREVIEW_CHANNEL,
      token, unitId: request.unitId, action: "download", requestId }, location.origin);
  };
  const shareUrl = `${location.origin}${location.pathname}${location.search}`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopyState("copied"); }
    catch { setCopyState("error"); }
  };

  const active = request?.generation === nonce && opened?.resource.unitId === request.unitId ? opened : null;
  const preview = <>
    {request?.generation === nonce && <section aria-label={t("nativePreviewTitle")}
      className="absolute z-10 flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
      style={{ ...request.rect, visibility: request.rect.width < 1 || request.rect.height < 1 ? "hidden" : "visible" }}>
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
        <strong className="min-w-0 flex-1 truncate">{active?.name ?? t("nativePreviewTitle")}</strong>
        <span role="status" className="text-muted-foreground">{missing ? t("nativePreviewMissing") : ready ? t(active?.resource.editorMode === "edit" ? "nativePreviewEditable" : "nativePreviewReadOnly") : t("nativePreviewLoading")}</span>
        {downloadState === "error" && <span role="alert" className="text-destructive">{t("nativePreviewDownloadError")}</span>}
        {active && canDownload && <Button variant="secondary" size="sm" onClick={download} disabled={downloadState === "busy"}>
          <Download className="size-3" />{t(downloadState === "busy" ? "nativePreviewDownloading" : "nativePreviewDownload")}
        </Button>}
        {active && <a href={`/nodes/${encodeURIComponent(active.nodeId)}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 underline"><ExternalLink className="size-3" />{t("nativePreviewOpen")}</a>}
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label={t("close")}><X /></Button>
      </header>
      {error ? <p role="alert" className="p-4 text-sm text-destructive">{t("nativePreviewError")}</p> : active ?
        <iframe key={`${nonce}:${active.resource.unitId}`} ref={nativeFrame} title={`${t("nativePreviewTitle")}: ${active.name}`}
          className="min-h-0 w-full flex-1 border-0" src={`/preview/${encodeURIComponent(active.resource.unitId)}?token=${encodeURIComponent(token)}`}
          onLoad={() => nativeFrame.current?.contentWindow?.postMessage({ channel: NATIVE_PREVIEW_CHANNEL,
            token, unitId: active.resource.unitId, action: "status" }, location.origin)} /> :
        <p role="status" className="p-4 text-sm">{t("nativePreviewLoading")}</p>}
    </section>}
    <Dialog open={sharing} onOpenChange={setSharing} title={t("nativePreviewShare")} description={t("nativePreviewShareDescription")}>
      <input aria-label={t("nativePreviewShare")} readOnly value={shareUrl}
        className="w-full rounded border bg-muted p-3 text-sm" onFocus={event => event.currentTarget.select()} />
      <div className="mt-3 flex items-center justify-end gap-3">
        {copyState !== "idle" && <span role="status" className="text-sm text-muted-foreground">
          {t(copyState === "copied" ? "linkCopied" : "copyLinkFailed")}
        </span>}
        <Button onClick={() => void copyLink()}><Copy className="size-4" />{t("copyLink")}</Button>
      </div>
    </Dialog>
  </>;
  return { root, viewerRoot, html, preview, close };
}
