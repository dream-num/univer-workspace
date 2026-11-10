/** Original Worktree-local Unit operation behavior. */
import type { CreateWorktreeLocalUnitInput, WorktreeUnitDescriptor } from './worktree-api.js';
export class UnitOperationError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'UnitOperationError'; }
}
export interface UnitArguments {
  readonly action: 'create' | 'remove' | 'restore'; readonly worktreeId: string;
  readonly name?: string; readonly unitType?: 'sheet' | 'doc' | 'slide' | 'board' | 'base';
  readonly unitId?: string; readonly spaceId?: string; readonly parentNodeId?: string;
  readonly initialData?: unknown; readonly idempotencyKey?: string;
}
export interface UnitService {
  setWorktreeUnitRemoved(worktreeId: string, unitId: string, removed: boolean): Promise<WorktreeUnitDescriptor>;
  createWorktreeLocalUnit(input: CreateWorktreeLocalUnitInput): Promise<WorktreeUnitDescriptor>;
}
function resolveTargetSpace(defaultSpaceId: string, requested?: string): string {
  if (requested === undefined) return defaultSpaceId;
  const value = requested.trim();
  if (!value) throw new UnitOperationError('Space id must be non-empty.', 'INVALID_REQUEST');
  return value;
}
export async function runUnitOperation(args: UnitArguments, defaultSpaceId: string, service: UnitService) {
  if (args.worktreeId.trim() === "")
    throw new UnitOperationError("univer_unit requires worktreeId.", "INVALID_REQUEST");
  if (args.action === "remove" || args.action === "restore") {
    if (!args.unitId?.trim())
      throw new UnitOperationError(
        "univer_unit requires unitId for removal or restoration.",
        "INVALID_REQUEST",
      );
    return service.setWorktreeUnitRemoved(args.worktreeId, args.unitId, args.action === "remove");
  }
  const targetSpaceId = resolveTargetSpace(defaultSpaceId, args.spaceId);
  if (!args.unitType)
    throw new UnitOperationError("univer_unit create requires unitType.", "INVALID_REQUEST");
  if (!args.name?.trim())
    throw new UnitOperationError("univer_unit requires a non-empty name.", "INVALID_REQUEST");
  const idempotencyKey = args.idempotencyKey?.trim();
  if (args.idempotencyKey !== undefined && idempotencyKey === "") {
    throw new UnitOperationError("univer_unit idempotencyKey must be non-empty.", "INVALID_REQUEST");
  }
  if (
    args.initialData !== undefined &&
    (args.initialData === null ||
      typeof args.initialData !== "object" ||
      Array.isArray(args.initialData))
  ) {
    throw new UnitOperationError(
      "univer_unit initialData must be a JSON object.",
      "INVALID_REQUEST",
    );
  }
  const unit = await service.createWorktreeLocalUnit({
    worktreeId: args.worktreeId,
    name: args.name,
    unitType: args.unitType,
    targetSpaceId,
    targetParentNodeId: args.parentNodeId ?? null,
    ...(args.initialData === undefined
      ? {}
      : { initialData: args.initialData as Record<string, unknown> }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
  return unit;
}
