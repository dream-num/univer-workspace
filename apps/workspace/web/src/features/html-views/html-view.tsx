import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import { useQuery } from "@tanstack/react-query";
import {
  WorkspaceHtmlViewer,
  type WorkspaceHtmlViewerHandle,
} from "@univerjs/univer-workspace-html-viewer";
import { useI18n } from "../../shared/i18n";
import { Button } from "../../shared/ui";
import { anonymousUser, sessionQueryOptions } from "../auth";
import { createWorkspaceBindingEngine } from "./workspace-binding-engine";
import { isResourceViewChange } from "../resource-view/resource-view";

const HTML_VIEW_ALLOWED_ORIGINS = ["https://cdn.jsdelivr.net"] as const;

export function HtmlView({
  source,
  allowedOrigins,
  showControls,
}: {
  source: string;
  showControls: boolean;
  allowedOrigins?: readonly string[];
}) {
  const { t, language } = useI18n();
  const translation = useRef(t);
  translation.current = t;
  const session = useQuery(sessionQueryOptions);
  const user = session.data?.authenticated
    ? session.data.user
    : session.data
      ? anonymousUser
      : null;
  const viewer = useRef<WorkspaceHtmlViewerHandle>(null);
  const unsynced = useRef(false);
  const [error, setError] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const loadEngine = useCallback(
    (unitId: string, signal: AbortSignal) => {
      if (!user) throw new Error("Session is not ready.");
      return createWorkspaceBindingEngine(unitId, user, signal, (code) =>
        translation.current(
          code === "signInRequired" ? "htmlViewSignInRequired" : "htmlViewEditPermissionRequired",
        ),
      );
    },
    [user?.id, user?.displayName, user?.avatarUrl],
  );
  useEffect(() => {
    if (!showControls && inspecting) {
      void viewer.current?.inspect.close().catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    }
  }, [showControls, inspecting]);
  useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      if (isResourceViewChange(current, next)) return false;
      try {
        await viewer.current?.prepareToLeave();
        return false;
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
        return true;
      }
    },
    enableBeforeUnload: () => !!viewer.current?.hasPendingChanges() || unsynced.current,
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showControls && (
        <div className="flex shrink-0 justify-end border-b border-border px-3 py-1.5">
          <Button
            variant={inspecting ? "secondary" : "ghost"}
            size="sm"
            disabled={!user}
            aria-pressed={inspecting}
            onClick={() => {
              const operation = inspecting
                ? viewer.current?.inspect.close()
                : viewer.current?.inspect.open();
              void operation?.catch((reason: unknown) => {
                setError(reason instanceof Error ? reason.message : String(reason));
              });
            }}
          >
            {t("htmlViewInspect")}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="m-0 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {user ? (
        <WorkspaceHtmlViewer
          ref={viewer}
          source={source}
          locale={language}
          onInspectChanged={setInspecting}
          title={t("htmlViewTitle")}
          className="min-h-0 w-full flex-1 border-0"
          {...(allowedOrigins ? { allowedOrigins } : {})}
          loadEngine={loadEngine}
          onError={setError}
          onStatus={(states) => {
            unsynced.current = states.some((state) => state !== CollaborationStatus.SYNCED);
          }}
        />
      ) : null}
    </div>
  );
}

export function HtmlViewFile({
  resource,
  showControls,
}: {
  resource: { contentUrl: string; byteSize: number };
  showControls: boolean;
}) {
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
  return source === null ? null : (
    <HtmlView
      source={source}
      allowedOrigins={HTML_VIEW_ALLOWED_ORIGINS}
      showControls={showControls}
    />
  );
}
