import { ApplicationError } from "../../middleware/errors.js";
import type { ResourcesModule } from "../resources/index.js";
import type { WorktreesModule } from "../worktrees/index.js";
import {
  OperationsRepository,
  type OperationDatabaseKind,
  type OperationRow,
} from "./operations.repository.js";

export type OperationKind =
  | "createResource"
  | "createBlobResource"
  | "createWorktree"
  | "addWorktreeUnit"
  | "createWorktreeUnit"
  | "mergeWorktree"
  | "discardWorktree"
  | "activateWorktreeResource";

export interface OperationView {
  readonly id: string;
  readonly kind: OperationKind;
  readonly state: "pending" | "completed" | "failed";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: {
    readonly code: string;
    readonly message: string;
  } | null;
}

export interface OperationsModule {
  get(userId: string, operationId: string): OperationView;
  retry(userId: string, operationId: string): Promise<OperationView>;
}

export function createOperationsModule(options: {
  readonly repository: OperationsRepository;
  readonly resources: ResourcesModule;
  readonly worktrees: WorktreesModule;
  readonly now?: () => number;
}): OperationsModule {
  const now = options.now ?? Date.now;

  return {
    get(userId, operationId) {
      return operationView(
        requireOperation(options.repository, userId, operationId)
      );
    },

    async retry(userId, operationId) {
      const row = requireOperation(options.repository, userId, operationId);
      if (row.state !== "failed") {
        throw new ApplicationError(
          "CONFLICT",
          409,
          "Only a failed operation can be retried."
        );
      }
      if (row.kind === "create_resource") {
        await options.resources.retry(userId, operationId);
        return operationView(
          requireOperation(options.repository, userId, operationId)
        );
      }
      if (row.kind === "create_blob_resource") {
        throw new ApplicationError(
          "CONFLICT",
          409,
          "Blob publication is retried through its Upload Session."
        );
      }
      if (row.kind === "activate_worktree_resource") {
        throw new ApplicationError(
          "CONFLICT",
          409,
          "Resource activation is retried by its parent merge operation."
        );
      }
      options.repository.retry(operationId, userId, now());
      try {
        await retryWorktreeOperation(options.worktrees, userId, row);
      } catch (error) {
        options.repository.fail(
          operationId,
          userId,
          {
            code:
              error instanceof ApplicationError
                ? error.code
                : "INTERNAL_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "The operation retry failed.",
          },
          now()
        );
        throw error;
      }
      return operationView(
        requireOperation(options.repository, userId, operationId)
      );
    },
  };
}

async function retryWorktreeOperation(
  worktrees: WorktreesModule,
  userId: string,
  row: OperationRow
): Promise<void> {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  const worktreeId = requiredPayloadId(payload.worktreeId, "worktreeId");
  switch (row.kind) {
    case "create_worktree":
      await worktrees.create(userId, row.id, {
        kind: payload.kind,
        name: payload.name,
        summary: payload.summary,
        visibility: payload.visibility,
        teamSpaceId: payload.teamSpaceId,
      });
      return;
    case "add_worktree_unit":
      await worktrees.addUnit(userId, worktreeId, row.id, {
        source: "trunk",
        resourceId: payload.resourceId,
      });
      return;
    case "create_worktree_unit":
      await worktrees.addUnit(userId, worktreeId, row.id, {
        source: "worktree",
        name: payload.name,
        unitType: payload.unitType,
        targetSpaceId: payload.targetSpaceId,
        targetParentNodeId: payload.targetParentNodeId,
      });
      return;
    case "merge_worktree":
      await worktrees.merge(userId, worktreeId, row.id);
      return;
    case "discard_worktree":
      await worktrees.discard(userId, worktreeId, row.id);
      return;
    case "create_resource":
    case "create_blob_resource":
    case "activate_worktree_resource":
      return;
  }
}

function requiredPayloadId(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Operation payload is missing ${name}.`);
  }
  return value;
}

function requireOperation(
  repository: OperationsRepository,
  userId: string,
  operationId: string
): OperationRow {
  const row = repository.get(operationId, userId);
  if (!row) {
    throw new ApplicationError(
      "NOT_FOUND",
      404,
      "The operation was not found."
    );
  }
  return row;
}

function operationView(row: OperationRow): OperationView {
  return {
    id: row.id,
    kind: operationKind(row.kind),
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    result:
      row.result_json === null
        ? null
        : (JSON.parse(row.result_json) as Readonly<Record<string, unknown>>),
    error:
      row.last_error_code && row.last_error_message
        ? {
            code: row.last_error_code,
            message: row.last_error_message,
          }
        : null,
  };
}

function operationKind(kind: OperationDatabaseKind): OperationKind {
  const kinds: Record<OperationDatabaseKind, OperationKind> = {
    create_resource: "createResource",
    create_blob_resource: "createBlobResource",
    create_worktree: "createWorktree",
    add_worktree_unit: "addWorktreeUnit",
    create_worktree_unit: "createWorktreeUnit",
    merge_worktree: "mergeWorktree",
    discard_worktree: "discardWorktree",
    activate_worktree_resource: "activateWorktreeResource",
  };
  return kinds[kind];
}
