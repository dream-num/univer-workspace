import { workspaceError } from "./errors.js";
import type { WorkspaceRuntimeScope } from "./runtime-target.js";

export interface WorkspaceReferenceHostContext {
  readonly mappedUnitIds: readonly string[];
  readonly scope: WorkspaceRuntimeScope;
}

export type WorkspaceReferenceSourceScope =
  | { readonly kind: "trunk"; readonly unitId: string }
  | { readonly kind: "worktree"; readonly unitId: string; readonly worktreeId: string };

export function selectWorkspaceReferenceScope(
  host: WorkspaceReferenceHostContext,
  unitId: string,
): WorkspaceReferenceSourceScope {
  const validUnitId = requireId(unitId, "Source Unit ID");
  if (host.scope.kind === "trunk" || !host.mappedUnitIds.includes(validUnitId)) {
    return { kind: "trunk", unitId: validUnitId };
  }
  return {
    kind: "worktree",
    unitId: validUnitId,
    worktreeId: requireId(host.scope.worktreeId, "Worktree ID"),
  };
}

function requireId(value: string, label: string): string {
  if (value.trim() === "") {
    throw workspaceError("workspace-reference-invalid-context", `${label} must not be empty.`);
  }
  return value;
}
