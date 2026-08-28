import { workspaceError } from "./errors.js";
import type { WorkspaceHttp } from "./http.js";
import type { WorkspaceReferenceHostContext } from "./reference-scope.js";
import type { WorkspaceRuntimeTarget } from "./runtime-target.js";
import { getWorktree } from "./worktree.js";

export async function loadWorkspaceReferenceHostContext(
  http: WorkspaceHttp,
  target: WorkspaceRuntimeTarget,
): Promise<WorkspaceReferenceHostContext> {
  if (target.scope.kind === "trunk") return { mappedUnitIds: [], scope: target.scope };
  const worktree = await getWorktree(http, target.scope.worktreeId);
  const host = worktree.units.find((unit) => unit.unitId === target.unitId);
  if (host === undefined) {
    throw workspaceError(
      "workspace-unit-not-found",
      "Workspace runtime target Unit is not in the selected Worktree.",
    );
  }
  if (host.draftHeadRevision !== target.revision) {
    throw workspaceError(
      "workspace-runtime-target-stale",
      "Workspace runtime target revision changed before the worker started.",
    );
  }
  return { mappedUnitIds: worktree.units.map((unit) => unit.unitId), scope: target.scope };
}
