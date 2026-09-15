import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import { useQuery } from "@tanstack/react-query";
import { parseHtmlView, type HtmlViewDocument } from "@univerjs-labs/html-view";
import { createBindingHost, createHtmlViewDocument } from "@univerjs-labs/html-view-renderer";
import runtime from "virtual:html-view-runtime";
import { sessionQueryOptions } from "../auth";
import { createWorkspaceBindingEngine } from "./workspace-binding-engine";
import { useResourceView } from "../resource-view/resource-view-context";
import { isResourceViewChange } from "../resource-view/resource-view";

const HTML_VIEW_ALLOWED_ORIGINS = ["https://cdn.jsdelivr.net"] as const;

export function HtmlView({
  source,
  allowedOrigins,
}: {
  source: string;
  allowedOrigins?: readonly string[];
}) {
  const parsed = useMemo(() => {
    try {
      return { data: parseHtmlView(source), error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [source]);
  if (!parsed.data)
    return (
      <p role="alert" className="p-6 text-destructive">
        {parsed.error}
      </p>
    );
  return <BoundHtmlView key={source} parsed={parsed.data} allowedOrigins={allowedOrigins} />;
}

function BoundHtmlView({
  parsed,
  allowedOrigins,
}: {
  parsed: HtmlViewDocument;
  allowedOrigins: readonly string[] | undefined;
}) {
  const { immersive } = useResourceView();
  const session = useQuery(sessionQueryOptions);
  const user = session.data?.authenticated ? session.data.user : null;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在加载…");
  const hostRef = useRef<ReturnType<typeof createBindingHost> | undefined>(undefined);
  const unsyncedRef = useRef(false);
  useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      if (isResourceViewChange(current, next)) return false;
      try {
        await hostRef.current?.flush();
        return false;
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
        return true;
      }
    },
    enableBeforeUnload: () => !!hostRef.current?.hasPendingChanges() || unsyncedRef.current,
  });
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !user) return;
    setError("");
    setStatus("正在加载…");
    unsyncedRef.current = false;
    const connectionId = crypto.randomUUID();
    let disposed = false;
    let host: ReturnType<typeof createBindingHost> | undefined;
    const connect = (event: MessageEvent) => {
      if (
        event.source !== iframe.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "univer-html-view-connect" ||
        event.data.token !== connectionId ||
        !event.ports[0]
      )
        return;
      if (host) {
        event.ports[0].close();
        return;
      }
      host = createBindingHost(event.ports[0], {
        loadEngine: (unitId, signal) => createWorkspaceBindingEngine(unitId, user, signal),
        onError: setError,
        onClose() {
          if (hostRef.current === host) hostRef.current = undefined;
          host = undefined;
        },
        onStatus(states) {
          unsyncedRef.current = states.some((state) => state !== CollaborationStatus.SYNCED);
          setStatus(
            states.every((state) => state === CollaborationStatus.SYNCED)
              ? "已保存"
              : states.includes(CollaborationStatus.OFFLINE)
                ? "连接中断，修改尚未同步"
                : states.includes(CollaborationStatus.CONFLICT)
                  ? "同步冲突，修改尚未同步"
                  : "同步中…",
          );
        },
      });
      hostRef.current = host;
      setStatus("已保存");
    };
    window.addEventListener("message", connect);
    try {
      const document = createHtmlViewDocument({
        template: parsed,
        runtime,
        connectionId,
        ...(allowedOrigins ? { allowedOrigins } : {}),
      });
      // StrictMode replays effects. Only the surviving effect may navigate the iframe;
      // competing srcdoc navigations can otherwise deliver the disposed host's token.
      queueMicrotask(() => {
        if (!disposed) iframe.srcdoc = document;
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
    return () => {
      disposed = true;
      window.removeEventListener("message", connect);
      host?.dispose();
      hostRef.current = undefined;
    };
  }, [parsed, user?.id, allowedOrigins]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p
        role="status"
        className={
          immersive && (status === "已保存" || status === "同步中…")
            ? "sr-only"
            : "m-0 px-4 py-2 text-sm text-muted-foreground"
        }
      >
        {status}
      </p>
      {error ? (
        <p role="alert" className="m-0 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <iframe
        title="HTML 绑定视图"
        className="min-h-0 w-full flex-1 border-0"
        ref={iframeRef}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

export function HtmlViewFile({ resource }: { resource: { contentUrl: string; byteSize: number } }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setSource(null);
    setError("");
    void fetch(resource.contentUrl, { credentials: "include", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("HTML view could not be loaded.");
        return response.text();
      })
      .then((content) => {
        if (!abort.signal.aborted) setSource(content);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [resource.contentUrl, resource.byteSize]);
  if (error)
    return (
      <p role="alert" className="p-6 text-destructive">
        {error}
      </p>
    );
  return source === null ? (
    <p className="p-6">正在加载 HTML 视图…</p>
  ) : (
    <HtmlView source={source} allowedOrigins={HTML_VIEW_ALLOWED_ORIGINS} />
  );
}
