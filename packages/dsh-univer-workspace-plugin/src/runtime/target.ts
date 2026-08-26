/**
 * The runtime target the capability plugin hands to the headless
 * collaboration worker pool. Unlike apps/cli, the dsh host runs the pool in
 * the same process that owns the credential store, so the target carries the
 * resolved workspace session token across the worker process boundary instead
 * of the worker reading it from a session file.
 * @module dsh-univer-workspace-plugin/runtime/target
 */

import { UniverType } from "@univerjs/protocol";

export type WorkspaceUnitType = "sheet" | "doc" | "slide" | "base" | "board";

export type WorkspaceRuntimeScope =
  | { readonly kind: "trunk" }
  | { readonly kind: "worktree"; readonly worktreeId: string };

export interface WorkspaceRuntimeTarget {
  readonly origin: string;
  readonly revision: number;
  readonly scope: WorkspaceRuntimeScope;
  readonly unitId: string;
  readonly unitType: WorkspaceUnitType;
  /** The `workspace_session` token (the cookie value, not the header). */
  readonly sessionToken: string;
}

export function workspaceSnapshotPrefix(scope: WorkspaceRuntimeScope): string {
  return scope.kind === "trunk"
    ? "/universer-api/snapshot"
    : `/universer-api/worktrees/${encodeURIComponent(scope.worktreeId)}/snapshot`;
}

export function workspaceRuntimeKey(target: WorkspaceRuntimeTarget): string {
  const scope =
    target.scope.kind === "trunk"
      ? "trunk"
      : `worktree:${encodeURIComponent(target.scope.worktreeId)}`;
  return [
    "workspace",
    encodeURIComponent(target.origin),
    scope,
    encodeURIComponent(target.unitId),
    target.unitType,
  ].join(":");
}

export function toUniverType(unitType: WorkspaceUnitType): UniverType {
  switch (unitType) {
    case "sheet":
      return UniverType.UNIVER_SHEET;
    case "doc":
      return UniverType.UNIVER_DOC;
    case "slide":
      return UniverType.UNIVER_SLIDE;
    case "base":
      return UniverType.UNIVER_BASE;
    case "board":
      return UniverType.UNIVER_BOARD;
  }
}
