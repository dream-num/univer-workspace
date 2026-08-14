import type { ILogContext } from "@univerjs-pro/collaboration";
import { WorkspaceReferenceProviderError } from "./errors.js";

export const WORKSPACE_REFERENCE_SCOPE_METADATA_KEY =
  "univer.workspace.reference-source-scope.v1";

export type WorkspaceReferenceHostContext =
  | {
      readonly view: { readonly kind: "trunk" };
    }
  | {
      readonly mappedUnitIds: readonly string[];
      readonly view: {
        readonly kind: "worktree";
        readonly worktreeId: string;
      };
    }
  | {
      readonly mappedUnitIds: readonly string[];
      readonly view: {
        readonly kind: "mergePreview";
        readonly worktreeId: string;
      };
    };

export type WorkspaceReferenceSourceScope =
  | {
      readonly kind: "trunk";
      readonly unitId: string;
    }
  | {
      readonly kind: "worktree";
      readonly unitId: string;
      readonly worktreeId: string;
    }
  | {
      readonly kind: "mergePreview";
      readonly unitId: string;
      readonly worktreeId: string;
    };

export interface WorkspaceReferenceScopePolicy {
  select(unitId: string): WorkspaceReferenceSourceScope;
}

export function createWorkspaceReferenceScopePolicy(
  input: WorkspaceReferenceHostContext,
): WorkspaceReferenceScopePolicy {
  if (input.view.kind === "trunk") {
    return {
      select: (unitId) => ({ kind: "trunk", unitId: validUnitId(unitId) }),
    };
  }

  if (!("mappedUnitIds" in input)) {
    throw new WorkspaceReferenceProviderError(
      "invalid-host-context",
      "Workspace Worktree Host context requires mapped Unit IDs.",
    );
  }
  const worktreeId = validWorktreeId(input.view.worktreeId);
  const mappedUnitIds = new Set(input.mappedUnitIds.map(validUnitId));
  return {
    select(unitId) {
      const validId = validUnitId(unitId);
      if (!mappedUnitIds.has(validId)) {
        return { kind: "trunk", unitId: validId };
      }
      return input.view.kind === "worktree"
        ? { kind: "worktree", unitId: validId, worktreeId }
        : { kind: "mergePreview", unitId: validId, worktreeId };
    },
  };
}

export function createWorkspaceReferenceLoadContext(
  scope: WorkspaceReferenceSourceScope,
): ILogContext {
  return {
    metadata: {
      [WORKSPACE_REFERENCE_SCOPE_METADATA_KEY]: JSON.stringify({
        version: 1,
        ...scope,
      }),
    },
  };
}

export function readWorkspaceReferenceSourceScope(
  context: ILogContext,
  expectedUnitId?: string,
): WorkspaceReferenceSourceScope | undefined {
  const encoded = context.metadata?.[WORKSPACE_REFERENCE_SCOPE_METADATA_KEY];
  if (encoded === undefined) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw invalidLoadContext("Workspace Reference load context is not valid JSON.");
  }
  if (!isRecord(value) || value.version !== 1) {
    throw invalidLoadContext("Workspace Reference load context has an unsupported version.");
  }

  const unitId = validLoadContextUnitId(value.unitId);
  if (expectedUnitId !== undefined && unitId !== expectedUnitId) {
    throw invalidLoadContext("Workspace Reference load context targets a different Unit.", {
      actualUnitId: unitId,
      expectedUnitId,
    });
  }
  if (value.kind === "trunk") return { kind: "trunk", unitId };
  if (value.kind !== "worktree" && value.kind !== "mergePreview") {
    throw invalidLoadContext("Workspace Reference load context has an unsupported scope kind.");
  }
  return {
    kind: value.kind,
    unitId,
    worktreeId: validLoadContextWorktreeId(value.worktreeId),
  };
}

function validUnitId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkspaceReferenceProviderError(
      "invalid-unit-id",
      "Workspace Source Unit ID must be a non-empty string.",
    );
  }
  return value;
}

function validWorktreeId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkspaceReferenceProviderError(
      "invalid-host-context",
      "Workspace Host context requires a non-empty Worktree ID.",
    );
  }
  return value;
}

function validLoadContextUnitId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidLoadContext("Workspace Reference load context has an invalid Unit ID.");
  }
  return value;
}

function validLoadContextWorktreeId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidLoadContext("Workspace Reference load context has an invalid Worktree ID.");
  }
  return value;
}

function invalidLoadContext(
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): WorkspaceReferenceProviderError {
  return new WorkspaceReferenceProviderError("invalid-load-context", message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
