import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { BindingEngine } from "@univerjs/binding-engine";
import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import type { IDisposable } from "@univerjs/core";
import { useQuery } from "@tanstack/react-query";
import {
  parseHtmlView,
  getHtmlViewUnitIds,
  MAX_HTML_VIEW_BYTES,
  type HtmlViewDocument,
} from "@univerjs/workspace-html-view";
import { mountHtmlView } from "@univerjs/html-view-renderer";
import { sessionQueryOptions } from "../auth";
import { createWorkspaceBindingEngine } from "./workspace-binding-engine";

export function HtmlView({ source }: { source: string }) {
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
  return <BoundHtmlView key={source} parsed={parsed.data} />;
}

function BoundHtmlView({ parsed }: { parsed: HtmlViewDocument }) {
  const session = useQuery(sessionQueryOptions);
  const user = session.data?.authenticated ? session.data.user : null;
  const [document, setDocument] = useState<Document | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在加载…");
  const enginesRef = useRef(new Map<string, BindingEngine>());
  const mountedRef = useRef<ReturnType<typeof mountHtmlView> | undefined>(undefined);
  useBlocker({
    shouldBlockFn: async () => {
      const root = document?.documentElement;
      const wasInert = root?.inert ?? false;
      if (root) root.inert = true;
      try {
        mountedRef.current?.flush();
        await Promise.all([...enginesRef.current.values()].map((engine) => engine.flush()));
        return false;
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
        return true;
      } finally {
        if (root) root.inert = wasInert;
      }
    },
    enableBeforeUnload: () =>
      !!mountedRef.current?.hasPendingChanges() ||
      [...enginesRef.current.values()].some(
        (engine) => engine.getCollaborationStatus() !== CollaborationStatus.SYNCED,
      ),
  });
  useEffect(() => {
    if (!document || !user) return;
    setError("");
    setStatus("正在加载…");
    const abort = new AbortController();
    const engines = new Map<string, BindingEngine>();
    enginesRef.current = engines;
    const subscriptions: IDisposable[] = [];
    let mounted: ReturnType<typeof mountHtmlView> | undefined;
    const unitIds = getHtmlViewUnitIds(parsed);
    const updateStatus = () => {
      if (abort.signal.aborted || engines.size !== unitIds.length) return;
      const states = [...engines.values()].map((engine) => engine.getCollaborationStatus());
      setStatus(
        states.every((state) => state === CollaborationStatus.SYNCED)
          ? "已保存"
          : states.includes(CollaborationStatus.OFFLINE)
            ? "连接中断，修改尚未同步"
            : states.includes(CollaborationStatus.CONFLICT)
              ? "同步冲突，修改尚未同步"
              : "同步中…",
      );
    };
    const dispose = () => {
      abort.abort();
      mounted?.dispose();
      if (mountedRef.current === mounted) mountedRef.current = undefined;
      subscriptions.forEach((subscription) => subscription.dispose());
      engines.forEach((engine) => engine.dispose());
      engines.clear();
    };
    for (const control of document.querySelectorAll("[data-univer-cell-model]"))
      control.setAttribute("disabled", "");
    void Promise.all(
      unitIds.map(async (unitId) => {
        const engine = await createWorkspaceBindingEngine(unitId, user, abort.signal);
        if (abort.signal.aborted) {
          engine.dispose();
          return;
        }
        engines.set(unitId, engine);
        subscriptions.push(engine.subscribeCollaborationStatus(updateStatus));
      }),
    )
      .then(() => {
        if (abort.signal.aborted) return;
        mounted = mountHtmlView({ document, template: parsed, engines, onError: setError });
        mountedRef.current = mounted;
        updateStatus();
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        dispose();
        setStatus("加载失败");
        setError(error instanceof Error ? error.message : String(error));
      });
    return dispose;
  }, [document, parsed, user?.id]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p role="status" className="m-0 px-4 py-2 text-sm text-muted-foreground">
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
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={parsed.html}
        onLoad={(e) => setDocument(e.currentTarget.contentDocument)}
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
    if (resource.byteSize > MAX_HTML_VIEW_BYTES) {
      setError("HTML view exceeds 1 MiB.");
      return;
    }
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
    <HtmlView source={source} />
  );
}
