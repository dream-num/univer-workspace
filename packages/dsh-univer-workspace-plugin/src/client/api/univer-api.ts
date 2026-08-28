/**
 * Browser fetch helpers for the plugin's own host routes.
 * @module dsh-univer-workspace-plugin/client/api/univer-api
 */

import type { DocumentFileState, WorktreeAction } from "../../shared/state.ts";

/** Poll collaboration state for one docKey (`res:<id>` or `wt:<id>`).
 * Only a missing DOCUMENT (res) counts as missing — a processed worktree
 * keeps its panel rendering as unavailable, mirroring office. */
export async function getFileState(docKey: string): Promise<DocumentFileState> {
  const query = docKey.startsWith("wt:") ? `worktreeId=${encodeURIComponent(docKey.slice(3))}` : `resourceId=${encodeURIComponent(docKey.slice(4))}`;
  const response = await fetch(`/univer-workspace/api/file-state?${query}`, { headers: { accept: "application/json" } });
  if (response.status === 404) {
    if (docKey.startsWith("res:")) throw new Error("missing univer document");
    throw new Error("worktree processed");
  }
  if (!response.ok) throw new Error(`file state answered ${response.status}`);
  return await response.json() as DocumentFileState;
}

export function isMissingDocument(error: unknown): boolean {
  return error instanceof Error && (error.message === "missing univer document" || error.message === "worktree processed");
}

/** Whether an error came from a missing document (the caller hides the surface). */

/** Drive a review transition on one worktree. */
export async function postWorktreeAction(worktreeId: string, action: WorktreeAction): Promise<void> {
  const response = await fetch(`/univer-workspace/api/worktrees/${encodeURIComponent(worktreeId)}/${action}`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json() as { error?: { message?: unknown } | unknown };
      const error = body.error;
      detail = typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
        ? `: ${(error as { message: string }).message}`
        : typeof error === "string" ? `: ${error}` : "";
    } catch { /* retain the status-only fallback */ }
    throw new Error(`worktree ${action} answered ${response.status}${detail}`);
  }
}
