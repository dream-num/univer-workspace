/** Original Workspace document and Worktree status behavior. */
import type { JsonValue } from './json-value.js';
import type { WorkspaceDocumentOpen } from './wire.js';
import type { DocumentFileState } from './state.js';
export class StatusOperationError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'StatusOperationError'; }
}
export interface StatusArguments { readonly resourceId?: string; readonly unitId?: string; readonly worktreeId?: string }
export interface StatusService {
  resolveUnitResource(unitId: string): Promise<WorkspaceDocumentOpen>;
  openDocument(resourceId: string): Promise<WorkspaceDocumentOpen>;
  getFileState(resourceId: string): Promise<DocumentFileState>;
  getWorktreeFileState(worktreeId: string): Promise<DocumentFileState>;
  assertWorktreeAccessible(worktreeId: string): Promise<void>;
}
function nonEmptyArgument(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) throw new StatusOperationError(`univer_status ${name} must be non-empty.`, 'INVALID_REQUEST');
  return trimmed;
}
export async function runDocumentStatus(args: StatusArguments, service: StatusService) {
  const resourceId = nonEmptyArgument(args.resourceId, "resourceId");
  const worktreeId = nonEmptyArgument(args.worktreeId, "worktreeId");
  const unitId = nonEmptyArgument(args.unitId, "unitId");
  if (resourceId === undefined && worktreeId === undefined && unitId === undefined) {
    throw new StatusOperationError(
      "univer_status requires resourceId, unitId, or worktreeId.",
      "INVALID_REQUEST",
    );
  }

  // A trunk Unit id is a first-class identity in the Office-compatible
  // execution surface.  The Workspace product exposes a dedicated
  // unit→Resource bridge, so callers that already have `unitId` should
  // not be forced to rediscover the Resource id first.
  if (worktreeId === undefined && resourceId === undefined && unitId !== undefined) {
    const document = await service.resolveUnitResource(unitId);
    const fileState = await service.getFileState(document.resourceId);
    return {
      ...document,
      document: document as unknown as JsonValue,
      unit: document as unknown as JsonValue,
      fileState: fileState as unknown as JsonValue,
    };
  }

  // A Worktree-local Unit has a reserved resourceId before it is merged,
  // but that id is intentionally not visible through /api/resources.
  // Read the Worktree first and only resolve a product Resource when the
  // selected Unit is actually anchored in trunk.
  if (worktreeId !== undefined) {
    await service.assertWorktreeAccessible(worktreeId);
    const fileState = await service.getWorktreeFileState(worktreeId);
    const worktree = fileState.worktrees.find((entry) => entry.worktreeId === worktreeId);
    if (worktree === undefined) {
      throw new StatusOperationError(
        "univer_status Worktree state is unavailable.",
        "WORKTREE_NOT_FOUND",
      );
    }
    const selected =
      unitId === undefined
        ? resourceId === undefined
          ? worktree.units[0]
          : worktree.units.find((unit) => unit.resourceId === resourceId)
        : worktree.units.find((unit) => unit.unitId === unitId);
    if (unitId !== undefined && selected === undefined) {
      throw new StatusOperationError(
        "The requested Unit is not part of the selected Worktree.",
        "UNIT_NOT_FOUND",
      );
    }
    if (resourceId !== undefined && selected === undefined) {
      throw new StatusOperationError(
        "The requested Resource is not part of the selected Worktree.",
        "WORKSPACE_NOT_FOUND",
      );
    }
    if (
      resourceId !== undefined &&
      selected !== undefined &&
      selected.resourceId !== resourceId
    ) {
      throw new StatusOperationError(
        "The requested Resource does not belong to the selected Unit.",
        "WORKSPACE_SCOPE_DENIED",
      );
    }
    let document: WorkspaceDocumentOpen | null = null;
    if (selected !== undefined && selected.source === "trunk") {
      document = await service.openDocument(selected.resourceId);
    } else if (resourceId !== undefined && selected === undefined) {
      // Keep the error above deterministic and avoid probing a Resource
      // that is not in this Worktree.
      throw new StatusOperationError(
        "The requested Resource is not part of the selected Worktree.",
        "WORKSPACE_NOT_FOUND",
      );
    }
    return {
      ...(document === null ? {} : document),
      ...(selected === undefined
        ? {}
        : {
            resourceId: selected.resourceId,
            unitId: selected.unitId,
            unitType: selected.unitType,
            name: selected.name,
            editorMode: (selected.source === "worktree" && worktree.status === "draft"
              ? "edit"
              : "readOnly") as "edit" | "readOnly",
          }),
      worktreeId,
      document: document as unknown as JsonValue,
      unit: (selected ?? null) as unknown as JsonValue,
      fileState: fileState as unknown as JsonValue,
    };
  }

  // Without a Worktree, status is a trunk Resource operation.  The
  // explicit resourceId requirement is enforced after trimming so an
  // empty model argument cannot accidentally resolve a broad listing.
  const trunkResourceId = resourceId!;
  const document = await service.openDocument(trunkResourceId);
  if (unitId !== undefined && unitId !== document.unitId) {
    throw new StatusOperationError(
      "The requested Unit does not belong to the selected Resource.",
      "UNIT_NOT_FOUND",
    );
  }
  const fileState = await service.getFileState(trunkResourceId);
  return {
    ...document,
    document: document as unknown as JsonValue,
    unit: document as unknown as JsonValue,
    fileState: fileState as unknown as JsonValue,
  };
}
