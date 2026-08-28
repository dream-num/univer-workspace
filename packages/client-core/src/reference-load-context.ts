import type { ILogContext } from "@univerjs-pro/collaboration";
import { workspaceError } from "./errors.js";
import type { WorkspaceReferenceSourceScope } from "./reference-scope.js";

const REFERENCE_SCOPE_METADATA_KEY = "univer.workspace.reference-source-scope.v1";

export function createWorkspaceReferenceLoadContext(
  scope: WorkspaceReferenceSourceScope,
): ILogContext {
  return {
    metadata: {
      [REFERENCE_SCOPE_METADATA_KEY]: JSON.stringify({ version: 1, ...scope }),
    },
  };
}

export function readWorkspaceReferenceScope(
  context: ILogContext,
  expectedUnitId?: string,
): WorkspaceReferenceSourceScope | undefined {
  const encoded = context.metadata?.[REFERENCE_SCOPE_METADATA_KEY];
  if (encoded === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(encoded) as unknown;
  } catch {
    throw invalidContext("Workspace reference context is not valid JSON.");
  }
  if (!isRecord(value) || value["version"] !== 1) {
    throw invalidContext("Workspace reference context has an unsupported version.");
  }
  const unitId = requireId(value["unitId"], "Unit ID");
  if (expectedUnitId !== undefined && unitId !== expectedUnitId) {
    throw invalidContext("Workspace reference context targets a different Unit.");
  }
  if (value["kind"] === "trunk") {
    if (Object.keys(value).length !== 3) {
      throw invalidContext("Workspace reference context has an unsupported scope.");
    }
    return { kind: "trunk", unitId };
  }
  if (value["kind"] !== "worktree") {
    throw invalidContext("Workspace reference context has an unsupported scope.");
  }
  if (Object.keys(value).length !== 4) {
    throw invalidContext("Workspace reference context has an unsupported scope.");
  }
  return {
    kind: "worktree",
    unitId,
    worktreeId: requireId(value["worktreeId"], "Worktree ID"),
  };
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidContext(`Workspace reference ${label} is invalid.`);
  }
  return value;
}

function invalidContext(message: string): Error {
  return workspaceError("workspace-reference-invalid-load-context", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
