import { ScanSearch } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import type { HtmlViewWriteMode } from "@univerjs/univer-workspace-html-viewer/engine";
import { useQuery } from "@tanstack/react-query";
import {
  WorkspaceHtmlViewer,
  type WorkspaceHtmlViewerHandle,
} from "@univerjs/univer-workspace-html-viewer";
import { useI18n } from "../../shared/i18n";
import { Button, Spinner } from "../../shared/ui";
import { anonymousUser, sessionQueryOptions } from "../auth";
import { createWorkspaceBindingEngine, HtmlViewSourceSheetRequiredError, HtmlViewUndeclaredSourceError, type HtmlViewEngine, type HtmlViewSourceWorktree } from "./workspace-binding-engine";
import { useNativeUnitPreview } from "./native-unit-preview";
import { isResourceViewChange } from "../resource-view/resource-view";
import { resolveWorkspaceMedia, workspaceMediaSources } from "./workspace-media";

const HTML_VIEW_ALLOWED_ORIGINS = ["https://cdn.jsdelivr.net"] as const;
const HTML_VIEW_MEDIA_SOURCES = workspaceMediaSources(window.location.origin);

export function HtmlView({
  source,
  allowedOrigins = HTML_VIEW_ALLOWED_ORIGINS,
  mediaSources = HTML_VIEW_MEDIA_SOURCES,
  immersive,
  actionsContainer,
  draft = false,
  hideDraftNotice = false,
  onSourceLoaded,
  sourceWorktree,
  allowedUnitIds,
  trialAction,
}: {
  source: string;
  immersive: boolean;
  actionsContainer: HTMLElement | null;
  draft?: boolean;
  /** For hosts that label trial mode themselves. */
  hideDraftNotice?: boolean;
  sourceWorktree?: HtmlViewSourceWorktree | undefined;
  /** For a reader who did not write the page: only these Units load, and the page is told when it asks for another. */
  allowedUnitIds?: readonly string[] | undefined;
  onSourceLoaded?: (unitId: string, engine: HtmlViewEngine) => void;
  trialAction?: ReactNode;
  allowedOrigins?: readonly string[];
  mediaSources?: readonly string[];
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
  const writeModes = useMemo(() => new Map<string, HtmlViewWriteMode>(), [source, user?.id, draft, sourceWorktree]);
  const native = useNativeUnitPreview(source, user?.id ?? "pending", writeModes, !draft);
  const [trial, setTrial] = useState(false);
  useEffect(() => setTrial(false), [source, user?.id, draft, sourceWorktree]);
  const viewer = useRef<WorkspaceHtmlViewerHandle>(null);
  const unsynced = useRef(false);
  const [error, setError] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<readonly string[]>([]);
  useEffect(() => setBlocked([]), [source, allowedUnitIds]);
  const allowUnit = useMemo(() => allowedUnitIds && ((unitId: string) => {
    if (allowedUnitIds.includes(unitId)) return true;
    setBlocked((ids) => ids.includes(unitId) ? ids : [...ids, unitId]);
    return false;
  }), [allowedUnitIds]);
  const loadEngine = useCallback(
    async (unitId: string, signal: AbortSignal) => {
      if (!user) throw new Error("Session is not ready.");
      const engine = await createWorkspaceBindingEngine(unitId, user, signal, (code) =>
        translation.current(
          code === "signInRequired" ? "htmlViewSignInRequired" : "htmlViewEditPermissionRequired",
        ),
        () => setTrial(true),
        draft,
        sourceWorktree,
        allowUnit,
      ).catch((error: unknown) => {
        if (error instanceof HtmlViewSourceSheetRequiredError)
          throw new Error(translation.current("htmlViewSourceSheetRequired"));
        if (error instanceof HtmlViewUndeclaredSourceError)
          throw new Error(translation.current("htmlViewUndeclaredSource"));
        throw error;
      });
      writeModes.set(unitId, engine.writeMode);
      onSourceLoaded?.(unitId, engine);
      return engine;
    },
    [user?.id, user?.displayName, user?.avatarUrl, writeModes, draft, sourceWorktree, allowUnit, onSourceLoaded],
  );
  useEffect(() => {
    if (inspecting) native.close();
    if (immersive && inspecting) {
      void viewer.current?.inspect.close().catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    }
  }, [immersive, inspecting]);
  useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      if (isResourceViewChange(current, next)) return false;
      if (!viewer.current?.hasLocalChanges()) return false;
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
    <div ref={native.root} className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {actionsContainer &&
        createPortal(
          <Button
            variant="secondary"
            className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
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
            <ScanSearch />
            {t("htmlViewInspect")}
          </Button>,
          actionsContainer,
        )}
      {draft && !hideDraftNotice && <p role="status" className="m-0 shrink-0 border-b border-border px-4 py-2 text-sm">{t("htmlViewDraftNotice")}</p>}
      {blocked.length > 0 && <p role="alert" className="m-0 shrink-0 border-b border-border bg-amber-50 px-4 py-2 text-sm text-amber-950">{t("htmlViewUndeclaredSourcesBlocked", { units: blocked.join(", ") })}</p>}
      {error ? (
        <p role="alert" className="m-0 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div ref={native.viewerRoot} className="relative flex min-h-0 flex-1 flex-col">
        {user ? (
          <WorkspaceHtmlViewer
            ref={viewer}
            source={native.html}
            locale={language}
            onInspectChanged={setInspecting}
            onLoadingChanged={setLoading}
            title={t("htmlViewTitle")}
            className="min-h-0 w-full flex-1 border-0"
            {...(allowedOrigins ? { allowedOrigins } : {})}
            {...(mediaSources ? { mediaSources } : {})}
            loadEngine={loadEngine}
            onError={setError}
            onStatus={(states) => {
              unsynced.current = states.some((state) => state !== CollaborationStatus.SYNCED && state !== CollaborationStatus.NOT_COLLAB);
            }}
          />
        ) : null}
        {loading && !error ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/85 backdrop-blur-[1px]">
            <p role="status" className="m-0 flex items-center gap-2.5 text-sm text-muted-foreground">
              <Spinner className="size-5 text-brand-600" />
              {t("htmlViewLoading")}
            </p>
          </div>
        ) : null}
      </div>
      {trial && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-amber-50 px-4 py-2 text-sm text-amber-950">
          <p role="status" className="m-0 min-w-0 flex-1">{t("htmlViewTrialNotice")}</p>
          {trialAction}
        </div>
      )}
      {!draft && native.preview}
    </div>
  );
}

export function HtmlViewFile({
  resource,
  immersive,
  actionsContainer,
  draft = false,
  trialAction,
}: {
  resource: { contentUrl: string; byteSize: number };
  immersive: boolean;
  actionsContainer: HTMLElement | null;
  draft?: boolean;
  trialAction?: ReactNode;
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
      .then((content) => resolveWorkspaceMedia(content, window.location.origin, abort.signal))
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
      mediaSources={HTML_VIEW_MEDIA_SOURCES}
      immersive={immersive}
      actionsContainer={actionsContainer}
      draft={draft}
      trialAction={trialAction}
    />
  );
}
