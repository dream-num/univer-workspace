/**
 * Frame overlay bridge for the middle Workspace content surface. The navigation
 * store is the single source of truth; Resource and Worktree surfaces own their
 * own chrome while the right column stays the native DSH Conversation.
 * @module dsh-univer-workspace-plugin/client/FileWorkspaceOverlay
 */

import { Button } from "@univerjs/univer-workspace-ui";
import { regionQuery, setConversationHidden, setRegion } from "./navigation/region-route.ts";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { WorkspaceResourceViewer } from "./components/WorkspaceResourceViewer.tsx";
import { WorkspaceBlobViewer } from "./components/WorkspaceBlobViewer.tsx";
import { WorkspaceWorktreeViewer } from "./components/WorkspaceWorktreeViewer.tsx";
import {
  hideConversation,
  applyConversationInset,
  clearConversationInset,
  measureWorktreeSurfaceWidth,
  observeSurfaceLeft,
  RESOURCE_SURFACE_WIDTH,
} from "./layout/conversation-inset.ts";
import type { SessionListState } from "./dsh-runtime-types.ts";
import type { ViewerLocale } from "./viewer-locale.ts";
import type { ViewerBootstrap } from "./viewer-bootstrap.ts";
import type { UniverLocaleKey } from "./locales.ts";
import type {
  WorkspaceResourceDescriptor,
  WorkspaceResourceReferenceInsertResult,
} from "./workspace-resource-reference.ts";
import type { ViewerSelection } from "./viewer/contracts.ts";
import { ConversationSurfaceResizeHandle } from "./layout/ConversationSurfaceResizeHandle.tsx";
import {
  resolveWorkspaceOverlaySurface,
  type WorkspaceNavigationStore,
} from "./navigation/workspace-navigation.ts";

export interface FileWorkspaceOverlayProps extends PropsRuntime<"shell.overlay"> {
  readonly loadViewerBootstrap: () => Promise<ViewerBootstrap>;
  readonly getViewerLocale: () => ViewerLocale;
  readonly t: (key: UniverLocaleKey) => string;
  readonly navigation: WorkspaceNavigationStore;
  readonly insertResourceReference: (
    sessionId: string | undefined,
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
}

/** Middle Resource or Worktree surface while content is open. */
export function FileWorkspaceOverlay(props: FileWorkspaceOverlayProps) {
  const { contentSurface } = useSyncExternalStore(
    props.navigation.subscribe,
    props.navigation.getSnapshot,
    props.navigation.getSnapshot,
  );
  const target = resolveWorkspaceOverlaySurface(contentSurface);
  // A DSH Session switch can replace the conversation DOM; re-apply the inset
  // so the adapter re-captures the fresh host (the cleanup restores the old
  // one first). The surface itself must not disappear on a session switch.
  const currentSessionId = props.useSessions((state: SessionListState) => state.current);
  const [right, setRight] = useState(() => regionQuery(window.location.hash).get("right"));
  useEffect(() => {
    const changed = () => setRight(regionQuery(window.location.hash).get("right"));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const conversationVisible =
    (right !== null && !right.startsWith("hidden/")) ||
    target === null;
  useEffect(() => {
    const query = regionQuery(window.location.hash);
    if (target === null && !query.has("center") && right?.startsWith("hidden/")) {
      query.set("right", right.slice(7));
      // Normalize an empty layout without adding an unreachable history entry.
      window.history.replaceState(window.history.state, "", `#/?${query}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }, [target, right]);
  useEffect(() => {
    if (conversationVisible) return;
    return hideConversation();
  }, [conversationVisible, currentSessionId]);
  const [surfaceLeft, setSurfaceLeft] = useState<number | null>(null);
  const [preferredSurfaceWidth, setPreferredSurfaceWidth] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const targetKind = target?.kind ?? null;
  const availableSurfaceWidth = measureWorktreeSurfaceWidth(viewportWidth, surfaceLeft ?? 280);
  const surfaceWidth = !conversationVisible
    ? Math.max(0, viewportWidth - (surfaceLeft ?? 280))
    : Math.min(
        preferredSurfaceWidth ??
          (targetKind === "worktree" ? availableSurfaceWidth : RESOURCE_SURFACE_WIDTH),
        availableSurfaceWidth,
      );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (target === null) return;
    const stopObservingSurfaceLeft = observeSurfaceLeft(setSurfaceLeft);
    return () => {
      stopObservingSurfaceLeft();
    };
  }, [targetKind, currentSessionId]);

  useEffect(() => {
    if (target === null) return;
    if (conversationVisible) applyConversationInset(surfaceWidth);
    return () => {
      clearConversationInset();
    };
  }, [targetKind, currentSessionId, surfaceWidth, conversationVisible]);

  const conversationToggle =
    target !== null ? (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={props.t(conversationVisible ? "session.hide" : "session.show")}
        title={props.t(conversationVisible ? "session.hide" : "session.show")}
        onClick={() => {
          if (currentSessionId !== undefined) setConversationHidden(conversationVisible, currentSessionId);
          else setRegion("right", conversationVisible ? null : "new");
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16" />
          <path d={conversationVisible ? "m8 9 3 3-3 3" : "m11 9-3 3 3 3"} />
        </svg>
      </Button>
    ) : null;
  const conversationHeaderToggle = conversationVisible && target !== null ? (
    <div style={{ position: "fixed", right: 12, top: 12, pointerEvents: "auto", zIndex: 50 }}>
      {conversationToggle}
    </div>
  ) : null;
  const headerAction = conversationVisible ? undefined : conversationToggle ?? undefined;
  if (target === null) return null;
  const resizeHandle =
    conversationVisible && surfaceLeft !== null ? (
      <ConversationSurfaceResizeHandle
        left={surfaceLeft}
        width={surfaceWidth}
        viewportWidth={viewportWidth}
        onWidthChange={setPreferredSurfaceWidth}
      />
    ) : null;
  if (target.kind === "resource") {
    return (
      <>
        {conversationHeaderToggle}
        <WorkspaceResourceViewer
          key={`${target.workspaceOrigin}:${target.resourceId}`}
          target={target}
          surfaceLeft={surfaceLeft}
          surfaceWidth={surfaceWidth}
          headerAction={headerAction}
          onClose={() => props.navigation.dispatch({ type: "close-content" })}
          loadViewerBootstrap={props.loadViewerBootstrap}
          getViewerLocale={props.getViewerLocale}
          t={props.t}
          insertResourceReference={(resource, selection) =>
            props.insertResourceReference(currentSessionId, resource, selection)
          }
        />
        {resizeHandle}
      </>
    );
  }
  if (target.kind === "blob") {
    return (
      <>
        {conversationHeaderToggle}
        <WorkspaceBlobViewer
          key={`${target.workspaceOrigin}:${target.resourceId}`}
          target={target}
          surfaceLeft={surfaceLeft}
          surfaceWidth={surfaceWidth}
          headerAction={headerAction}
          onClose={() => props.navigation.dispatch({ type: "close-content" })}
          t={props.t}
        />
        {resizeHandle}
      </>
    );
  }
  return (
    <>
      {conversationHeaderToggle}
      <WorkspaceWorktreeViewer
        key={`${target.workspaceOrigin}:${target.worktreeId}`}
        target={target}
        surfaceLeft={surfaceLeft}
        surfaceWidth={surfaceWidth}
        headerAction={headerAction}
        onClose={() => props.navigation.dispatch({ type: "close-content" })}
        loadViewerBootstrap={props.loadViewerBootstrap}
        getViewerLocale={props.getViewerLocale}
        t={props.t}
        insertResourceReference={(resource, selection) =>
          props.insertResourceReference(currentSessionId, resource, selection)
        }
      />
      {resizeHandle}
    </>
  );
}
