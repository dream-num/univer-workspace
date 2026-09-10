import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceResourceViewerProps } from "./components/WorkspaceResourceViewer.tsx";
import type { WorkspaceResourceDescriptor, WorkspaceResourceReferenceInsertResult } from "./workspace-resource-reference.ts";
import type { ViewerSelection } from "./viewer/contracts.ts";
import type { WorkspaceContentSurface } from "./navigation/workspace-navigation.ts";
import { WorkspaceResourceViewer } from "./components/WorkspaceResourceViewer.tsx";
import { WorkspaceBlobViewer } from "./components/WorkspaceBlobViewer.tsx";
import { WorkspaceWorktreeViewer } from "./components/WorkspaceWorktreeViewer.tsx";

import { getFileState, subscribeFileStateInvalidation } from "./api/univer-api.ts";
import type { DocumentWorktreeState } from "../shared/state.ts";
import type { UniverLocaleKey } from "./locales.ts";
import { statusLabel } from "./components/turn-context-card-model.ts";

export function WorkspaceSidecarTitle(props: PropsRuntime<"sidebar.right.pane.tab.title"> & {
  t: (key: UniverLocaleKey) => string;
}) {
  const { tab } = props.useTabInfo();
  const params = tab.navigation.params;
  const target = params && "target" in params ? params.target : undefined;
  const worktreeId = target?.kind === "worktree" ? target.worktreeId : undefined;
  const [worktree, setWorktree] = useState<DocumentWorktreeState>();
  useEffect(() => {
    setWorktree(undefined);
    if (!worktreeId) return;
    let active = true;
    let revision = 0;
    const reload = () => {
      const request = ++revision;
      void getFileState(`wt:${worktreeId}`).then(state => {
        if (active && request === revision) setWorktree(state.worktrees.find(item => item.worktreeId === worktreeId));
      }).catch(() => { if (active && request === revision) setWorktree(undefined); });
    };
    const unsubscribe = subscribeFileStateInvalidation(key => {
      if (key === null || key === `wt:${worktreeId}`) reload();
    });
    reload();
    return () => { active = false; unsubscribe(); };
  }, [worktreeId]);
  const current = worktree?.worktreeId === worktreeId ? worktree : undefined;
  const title = current ? `${current.name} · ${statusLabel(current.status, props.t)}` : target?.name ?? props.t("file.title");
  return <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%" }}>
    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.name ?? target?.name ?? props.t("file.title")}</span>
    {current ? <span style={{ flexShrink: 0 }}>{statusLabel(current.status, props.t)}</span> : null}
  </span>;
}

export const WORKSPACE_SIDECAR_KIND = "univer-workspace-preview";
declare module "@deepseek-ai/dsh-client-ui-sidebar-right/client" {
  interface SidebarRightTabParamsMap {
    "univer-workspace-preview": { target: WorkspaceContentSurface };
  }
}

type WorkspaceSidecarProps = PropsRuntime<"sidebar.right.pane.tab"> & Pick<
  WorkspaceResourceViewerProps,
  "loadViewerBootstrap" | "getViewerLocale" | "t"
> & {
  readonly insertResourceReference: (sessionId: string | undefined,
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: ViewerSelection) => WorkspaceResourceReferenceInsertResult;
};

/** DSH owns the session, tab lifetime and layout; Workspace owns only its content. */
export function WorkspaceSidecar(props: WorkspaceSidecarProps) {
  const { tab } = props.useTabInfo();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(() => window.dispatchEvent(new Event("resize")));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [tab.navigation.revision]);
  const params = tab.navigation.params;
  if (!params || !("target" in params)) return null;
  const target = params.target;
  const shared = {
    onClose: tab.actions.close,
    loadViewerBootstrap: props.loadViewerBootstrap,
    getViewerLocale: props.getViewerLocale,
    t: props.t,
    insertResourceReference: (resource: { resourceId: string; name: string }, selection?: Parameters<WorkspaceSidecarProps["insertResourceReference"]>[2]) =>
      props.insertResourceReference(props.sessionId, resource, selection),
  };
  const key = `${target.workspaceOrigin}:${target.kind}:${target.kind === "worktree" ? target.worktreeId : target.resourceId}`;
  return <div ref={container} data-workspace-sidecar-content style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
    {target.kind === "resource" ? <WorkspaceResourceViewer key={key} {...shared} target={target} />
      : target.kind === "blob" ? <WorkspaceBlobViewer key={key} {...shared} target={target} />
      : <WorkspaceWorktreeViewer key={key} {...shared} target={target} />}
  </div>;
}
