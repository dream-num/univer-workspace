/**
 * Document and Worktree review state projection.
 * @module dsh-univer-workspace-plugin/provider/file-state-api
 */

import type { WorkspaceHttpClient } from "./workspace-contract.ts";
import type { DocumentFileState } from "../shared/state.ts";
import { WorkspaceApiError } from "./api-errors.ts";
import { openResource } from "./resources-api.ts";
import { getWorktreeDetail, listReviewWorktrees, openWorktreeUnit } from "./worktree-api.ts";

export type { DocumentFileState };

/** FileState for a WORKTREE key: first unit anchors the trunk viewer, and the
 * worktree itself is the only related entry. */
export async function getWorktreeFileState(
  client: WorkspaceHttpClient,
  worktreeId: string,
): Promise<DocumentFileState> {
  // Resolve the requested Worktree directly.  Listing both active and
  // processed Worktrees here made one stale/corrupt historical Worktree poison
  // every Viewer poll and multiplied the request fan-out.  The detail route
  // already applies the authenticated user's ACL and returns a precise 404
  // for an expired Worktree, which the browser treats as processed.
  const worktree = await getWorktreeDetail(client, worktreeId).catch((error: unknown) => {
    if (error instanceof WorkspaceApiError && error.status === 404) {
      throw new WorkspaceApiError("worktree not found", 404, "NOT_FOUND");
    }
    throw error;
  });
  const first = worktree.units[0];
  let viewerTarget: DocumentFileState["viewerTarget"] = null;
  let resourceId = first?.resourceId ?? "";
  let workspaceUrl: string | null = null;
  if (first !== undefined) {
    // A Worktree-local Unit has a product resourceId before merge, but that
    // resource is deliberately not discoverable through `/api/resources`.
    // Open through the Worktree contract instead of treating it as a trunk
    // Resource; otherwise every fresh local Unit gets stuck in Loading.
    const mode =
      worktree.status === "draft"
        ? "draft"
        : worktree.status === "ready"
          ? "mergePreview"
          : "trunk";
    if (!(first.source === "worktree" && worktree.status === "discarded")) {
      const opened = await openWorktreeUnit(client, worktreeId, first.unitId, mode);
      viewerTarget = {
        unitId: opened.unitId,
        unitType: opened.unitType,
        readOnly: opened.editorMode !== "edit",
      };
    }
    // Only activated/trunk Units have a Workspace browser Node.  Keep the
    // link null for a draft-local Unit rather than manufacturing a dead URL.
    if (first.source === "trunk" || worktree.status === "merged") {
      const open = await openResource(client, first.resourceId);
      workspaceUrl = workspaceDocumentUrl(client, open.nodeId);
    }
  }
  const units = worktree.units.map((unit) => ({
    ...unit,
    ...(worktree.status === "draft"
      ? { worktreeUrl: workspaceWorktreeUrl(client, worktreeId, unit.unitId) }
      : {}),
    ...(worktree.status === "ready"
      ? { mergeUrl: workspaceWorktreeUrl(client, worktreeId, unit.unitId, "preview") }
      : {}),
  }));
  return {
    ok: true,
    workspaceOrigin: client.origin,
    resourceId,
    workspaceUrl,
    gatewayRunning: true,
    viewerTarget,
    worktrees: [
      {
        ...worktree,
        units,
        worktreeTarget:
          (worktree.status === "draft" || worktree.status === "ready") && first !== undefined
            ? { unitId: first.unitId, unitType: first.unitType, readOnly: true }
            : null,
        mergeTarget:
          worktree.status === "ready" && first !== undefined
            ? { unitId: first.unitId, unitType: first.unitType, readOnly: true }
            : null,
        openUrl:
          first === undefined ? null : workspaceWorktreeUrl(client, worktreeId, first.unitId),
      },
    ],
  };
}

/** Assemble the per-document state: trunk viewer plus related worktrees. */
export async function getFileState(
  client: WorkspaceHttpClient,
  resourceId: string,
): Promise<DocumentFileState> {
  const open = await openResource(client, resourceId);
  const trunkTarget = {
    unitId: open.unitId,
    unitType: open.unitType,
    readOnly: open.editorMode !== "edit",
  };
  const all = await listReviewWorktrees(client);
  const related = all
    .map((worktree) => {
      const units = worktree.units
        .filter((unit) => unit.resourceId === resourceId)
        .map((unit) => ({
          ...unit,
          ...(worktree.status === "draft"
            ? { worktreeUrl: workspaceWorktreeUrl(client, worktree.worktreeId, unit.unitId) }
            : {}),
          ...(worktree.status === "ready"
            ? {
                mergeUrl: workspaceWorktreeUrl(client, worktree.worktreeId, unit.unitId, "preview"),
              }
            : {}),
        }));
      if (units.length === 0) return undefined;
      const first = units[0]!;
      return {
        ...worktree,
        units,
        worktreeTarget:
          worktree.status === "draft" || worktree.status === "ready"
            ? { unitId: first.unitId, unitType: first.unitType, readOnly: true }
            : null,
        mergeTarget:
          worktree.status === "ready"
            ? { unitId: first.unitId, unitType: first.unitType, readOnly: true }
            : null,
        openUrl: workspaceWorktreeUrl(client, worktree.worktreeId, first.unitId),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  return {
    ok: true,
    workspaceOrigin: client.origin,
    resourceId,
    workspaceUrl: workspaceDocumentUrl(client, open.nodeId),
    gatewayRunning: true,
    viewerTarget: trunkTarget,
    worktrees: related,
  };
}
function workspaceDocumentUrl(client: WorkspaceHttpClient, nodeId: string): string {
  return new URL(`/nodes/${encodeURIComponent(nodeId)}`, client.origin).toString();
}

/** Build the canonical Workspace dashboard deep link used for agent drafts. */
export function workspaceWorktreeUrl(
  client: WorkspaceHttpClient,
  worktreeId: string,
  unitId: string,
  view: "agent" | "preview" = "agent",
): string {
  const url = new URL("/worktrees", client.origin);
  url.searchParams.set("worktree", worktreeId);
  url.searchParams.set("unit", unitId);
  url.searchParams.set("view", view === "preview" ? "preview" : "agent");
  return url.toString();
}
