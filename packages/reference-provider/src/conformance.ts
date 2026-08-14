import type {
  WorkspaceReferenceHostContext,
  WorkspaceReferenceSourceScope,
} from "./scope.js";

export interface WorkspaceReferenceScopeConformanceCase {
  readonly expected: WorkspaceReferenceSourceScope;
  readonly hostContext: WorkspaceReferenceHostContext;
  readonly name: string;
  readonly sourceUnitId: string;
}

export const WORKSPACE_REFERENCE_SCOPE_CONFORMANCE_CASES = [
  {
    name: "trunk Host reads Source trunk",
    hostContext: { view: { kind: "trunk" } },
    sourceUnitId: "source-unit",
    expected: { kind: "trunk", unitId: "source-unit" },
  },
  {
    name: "draft Host reads mapped Source Worktree projection",
    hostContext: {
      view: { kind: "worktree", worktreeId: "worktree-1" },
      mappedUnitIds: ["host-unit", "source-unit"],
    },
    sourceUnitId: "source-unit",
    expected: { kind: "worktree", unitId: "source-unit", worktreeId: "worktree-1" },
  },
  {
    name: "draft Host reads unmapped Source trunk",
    hostContext: {
      view: { kind: "worktree", worktreeId: "worktree-1" },
      mappedUnitIds: ["host-unit"],
    },
    sourceUnitId: "source-unit",
    expected: { kind: "trunk", unitId: "source-unit" },
  },
  {
    name: "merge Host reads mapped Source merge preview",
    hostContext: {
      view: { kind: "mergePreview", worktreeId: "worktree-1" },
      mappedUnitIds: ["host-unit", "source-unit"],
    },
    sourceUnitId: "source-unit",
    expected: { kind: "mergePreview", unitId: "source-unit", worktreeId: "worktree-1" },
  },
  {
    name: "merge Host reads unmapped Source trunk",
    hostContext: {
      view: { kind: "mergePreview", worktreeId: "worktree-1" },
      mappedUnitIds: ["host-unit"],
    },
    sourceUnitId: "source-unit",
    expected: { kind: "trunk", unitId: "source-unit" },
  },
] as const satisfies readonly WorkspaceReferenceScopeConformanceCase[];
