/**
 * Browser fetch helpers for the plugin's own host routes.
 * @module dsh-univer-workspace-plugin/client/api/univer-api
 */

import type { DocumentFileState, WorktreeAction, WorktreeStateView } from "../../shared/state.ts";

export interface WorkspaceNodeLocation {
  readonly nodeId: string;
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  readonly shared: boolean;
  readonly space: {
    readonly id: string;
    readonly type: "personal" | "team";
    readonly name: string;
  };
  /** Already clipped by Workspace to the caller's navigation grant root. */
  readonly breadcrumbs: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

/** Resolve the caller-visible location of one Worktree Unit's existing Node. */
export async function getWorkspaceNodeLocation(
  nodeId: string,
  signal?: AbortSignal,
): Promise<WorkspaceNodeLocation> {
  const response = await fetch(`/univer-workspace/api/nodes/${encodeURIComponent(nodeId)}`, {
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 401) throw new Error("workspace_connection_required");
  if (response.status === 403 || response.status === 404) {
    throw new Error("workspace_node_location_unavailable");
  }
  if (!response.ok) throw new Error(`node location answered ${response.status}`);
  return narrowWorkspaceNodeLocation(await response.json(), nodeId);
}

function narrowWorkspaceNodeLocation(raw: unknown, expectedNodeId: string): WorkspaceNodeLocation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("node location returned malformed data");
  }
  const record = raw as Record<string, unknown>;
  const node = objectRecord(record.node);
  const space = objectRecord(record.space);
  const breadcrumbs = Array.isArray(record.breadcrumbs) ? record.breadcrumbs : undefined;
  const navigationRootNodeId = record.navigationRootNodeId;
  const accessRole = node?.accessRole;
  if (
    node?.id !== expectedNodeId ||
    typeof node.name !== "string" ||
    (accessRole !== "owner" &&
      accessRole !== "admin" &&
      accessRole !== "editor" &&
      accessRole !== "viewer") ||
    typeof space?.id !== "string" ||
    (space.type !== "personal" && space.type !== "team") ||
    typeof space.name !== "string" ||
    breadcrumbs === undefined ||
    (navigationRootNodeId !== null && typeof navigationRootNodeId !== "string")
  ) {
    throw new Error("node location returned malformed data");
  }
  const parsedBreadcrumbs = breadcrumbs.map((entry) => {
    const breadcrumb = objectRecord(entry);
    if (typeof breadcrumb?.id !== "string" || typeof breadcrumb.name !== "string") {
      throw new Error("node location returned malformed data");
    }
    return { id: breadcrumb.id, name: breadcrumb.name };
  });
  return {
    nodeId: node.id,
    name: node.name,
    accessRole,
    shared: navigationRootNodeId !== null,
    space: { id: space.id, type: space.type, name: space.name },
    breadcrumbs: parsedBreadcrumbs,
  };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** List all active and processed Worktrees visible to the connected identity. */
export async function getWorktrees(signal?: AbortSignal): Promise<readonly WorktreeStateView[]> {
  const response = await fetch("/univer-workspace/api/worktrees", {
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 401) throw new Error("workspace_connection_required");
  if (!response.ok) throw new Error(`worktree list answered ${response.status}`);
  const body = (await response.json()) as { worktrees?: unknown };
  if (!Array.isArray(body.worktrees)) throw new Error("worktree list returned malformed data");
  return body.worktrees as WorktreeStateView[];
}

/** Read collaboration state for one docKey (`res:<id>` or `wt:<id>`).
 * Only a missing DOCUMENT (res) counts as missing — a processed worktree
 * keeps its panel rendering as unavailable, mirroring office. */
const fileStateRequests = new Map<string, Promise<DocumentFileState>>();
const fileStateSnapshots = new Map<string, DocumentFileState>();

export async function getFileState(
  docKey: string,
  _signal?: AbortSignal,
): Promise<DocumentFileState> {
  const snapshot = fileStateSnapshots.get(docKey);
  if (snapshot !== undefined) return Promise.resolve(snapshot);
  const existing = fileStateRequests.get(docKey);
  if (existing !== undefined) return existing;
  const query = docKey.startsWith("wt:")
    ? `worktreeId=${encodeURIComponent(docKey.slice(3))}`
    : `resourceId=${encodeURIComponent(docKey.slice(4))}`;
  const request = (async (): Promise<DocumentFileState> => {
    const response = await fetch(`/univer-workspace/api/file-state?${query}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 401) {
      throw new Error("workspace_connection_required");
    }
    if (response.status === 404) {
      if (docKey.startsWith("res:")) throw new Error("missing univer document");
      throw new Error("worktree processed");
    }
    if (!response.ok) {
      let diagnosticId = "";
      try {
        const body = (await response.json()) as { diagnosticId?: unknown };
        if (typeof body.diagnosticId === "string")
          diagnosticId = ` (diagnostic id: ${body.diagnosticId})`;
      } catch {
        /* retain status-only fallback */
      }
      throw new Error(`file state answered ${response.status}${diagnosticId}`);
    }
    const value = (await response.json()) as DocumentFileState;
    fileStateSnapshots.set(docKey, value);
    return value;
  })();
  fileStateRequests.set(docKey, request);
  try {
    return await request;
  } finally {
    if (fileStateRequests.get(docKey) === request) fileStateRequests.delete(docKey);
  }
}

/** Invalidate one shared snapshot after an explicit Workspace mutation. */
export function invalidateFileState(docKey: string): void {
  fileStateSnapshots.delete(docKey);
}

export function isMissingDocument(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "missing univer document" || error.message === "worktree processed")
  );
}

/** Whether an error came from a missing document (the caller hides the surface). */

/** Drive a review transition on one worktree. */
export async function postWorktreeAction(
  worktreeId: string,
  action: WorktreeAction,
): Promise<void> {
  const response = await fetch(
    `/univer-workspace/api/worktrees/${encodeURIComponent(worktreeId)}/${action}`,
    {
      method: "POST",
      headers: { accept: "application/json" },
    },
  );
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: unknown } | unknown };
      const error = body.error;
      detail =
        typeof error === "object" &&
        error !== null &&
        typeof (error as { message?: unknown }).message === "string"
          ? `: ${(error as { message: string }).message}`
          : typeof error === "string"
            ? `: ${error}`
            : "";
    } catch {
      /* retain the status-only fallback */
    }
    throw new Error(`worktree ${action} answered ${response.status}${detail}`);
  }
  invalidateFileState(`wt:${worktreeId}`);
}
