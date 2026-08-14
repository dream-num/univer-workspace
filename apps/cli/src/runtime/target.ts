import type { JsonValue } from "@univer-cli/daemon";

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

export function parseWorkspaceRuntimeTarget(value: JsonValue): WorkspaceRuntimeTarget {
  if (
    !isRecord(value) ||
    typeof value["origin"] !== "string" ||
    typeof value["unitId"] !== "string" ||
    !isUnitType(value["unitType"]) ||
    !Number.isSafeInteger(value["revision"]) ||
    Number(value["revision"]) < 0
  ) {
    throw codedError("WORKSPACE_TARGET_INVALID", "Workspace runtime target is invalid");
  }
  const origin = normalizeOrigin(value["origin"]);
  const scope = parseScope(value["scope"]);
  return {
    origin,
    revision: Number(value["revision"]),
    scope,
    unitId: nonEmpty(value["unitId"], "unitId"),
    unitType: value["unitType"],
  };
}

function parseScope(value: JsonValue | undefined): WorkspaceRuntimeScope {
  if (!isRecord(value) || typeof value["kind"] !== "string") throw invalidTarget();
  if (value["kind"] === "trunk" && Object.keys(value).length === 1) return { kind: "trunk" };
  if (
    value["kind"] === "worktree" &&
    Object.keys(value).length === 2 &&
    typeof value["worktreeId"] === "string"
  ) {
    return { kind: "worktree", worktreeId: nonEmpty(value["worktreeId"], "worktreeId") };
  }
  throw invalidTarget();
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw codedError("WORKSPACE_ORIGIN_INVALID", "Workspace origin is invalid");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw codedError(
      "WORKSPACE_ORIGIN_INVALID",
      "Workspace origin must be an HTTP(S) origin without credentials or a path",
    );
  }
  return url.origin;
}

function nonEmpty(value: string, name: string): string {
  if (value.length === 0) throw codedError("WORKSPACE_TARGET_INVALID", `${name} must not be empty`);
  return value;
}

function isUnitType(value: JsonValue | undefined): value is WorkspaceUnitType {
  return (
    value === "sheet" ||
    value === "doc" ||
    value === "slide" ||
    value === "base" ||
    value === "board"
  );
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function invalidTarget(): Error {
  return codedError("WORKSPACE_TARGET_INVALID", "Workspace runtime target is invalid");
}
