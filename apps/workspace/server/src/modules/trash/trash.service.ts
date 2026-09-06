import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import { nodeSummary } from "../nodes/nodes.service.js";
import {
  TrashRepository,
  type TrashBatchRow,
  type TrashCursor,
} from "./trash.repository.js";
import type {
  TrashBatchView,
  TrashBlocker,
  TrashModule,
} from "./trash.types.js";

export function createTrashModule(options: {
  readonly repository: TrashRepository;
  readonly access: AccessResolver;
  readonly now?: () => number;
}): TrashModule {
  const now = options.now ?? Date.now;

  return {
    trashNode(userId, nodeId) {
      const node = options.access.resolveNode(userId, nodeId);
      if (!node) throw notFound();
      if (!node.capabilities.trash) throw forbidden();
      const batchId = randomUUID();
      options.repository.trashNode({
        batchId,
        nodeId,
        spaceId: node.spaceId,
        createdBy: userId,
        createdAt: now(),
      });
      const batch = options.repository.findBatch(batchId);
      if (!batch) throw new Error("Created Trash Batch is missing");
      return batchView(batch, options.repository);
    },

    list(userId, spaceId, page) {
      const space = options.access.resolveSpace(userId, spaceId);
      if (!space) throw notFound();
      if (!space.capabilities.viewTrash) throw notFound();
      const limit = validLimit(page.limit);
      const rows = options.repository.listBatches(
        spaceId,
        decodeCursor(page.cursor),
        limit + 1
      );
      const hasNext = rows.length > limit;
      const items = hasNext ? rows.slice(0, limit) : rows;
      const last = items.at(-1);
      return {
        items: items.map((batch) =>
          batchView(batch, options.repository)
        ),
        nextCursor:
          hasNext && last
            ? encodeCursor({ createdAt: last.created_at, id: last.id })
            : null,
      };
    },

    restore(userId, trashBatchId) {
      const batch = requireManageableBatch(
        userId,
        trashBatchId,
        options
      );
      const blockers = options.repository.blockers(batch);
      if (blockers.parentBatchId) {
        throw new ApplicationError(
          "RESTORE_PARENT_IN_TRASH",
          409,
          "Restore the parent Trash Batch first."
        );
      }
      options.repository.restore(batch, now());
      const restored = options.access.resolveNode(
        userId,
        batch.root_node_id
      );
      if (!restored) {
        throw new Error("Restored Node is not discoverable");
      }
      return nodeSummary(restored);
    },

    removePermanently(userId, trashBatchId) {
      const batch = requireManageableBatch(
        userId,
        trashBatchId,
        options
      );
      const blockers = options.repository.blockers(batch);
      if (blockers.nestedBatchId) {
        throw new ApplicationError(
          "NESTED_TRASH_BATCH",
          409,
          "Remove or restore the nested Trash Batch first."
        );
      }
      if (blockers.activeWorktreeReference) {
        throw new ApplicationError(
          "ACTIVE_WORKTREE_RESOURCE_REFERENCE",
          409,
          "An active Worktree references this content."
        );
      }
      options.repository.removePermanently(batch, now());
    },
  };
}

function requireManageableBatch(
  userId: string,
  batchId: string,
  options: {
    readonly repository: TrashRepository;
    readonly access: AccessResolver;
  }
): TrashBatchRow {
  const batch = options.repository.findBatch(batchId);
  if (!batch || batch.restored_at !== null) throw notFound();
  const space = options.access.resolveSpace(userId, batch.space_id);
  if (!space?.capabilities.viewTrash) throw notFound();
  return batch;
}

function batchView(
  batch: TrashBatchRow,
  repository: TrashRepository
): TrashBatchView {
  const blockers = repository.blockers(batch);
  const restoreBlockedBy: TrashBlocker | null = blockers.parentBatchId
    ? {
        code: "RESTORE_PARENT_IN_TRASH",
        trashBatchId: blockers.parentBatchId,
      }
    : null;
  const removeBlockedBy: TrashBlocker | null = blockers.nestedBatchId
    ? {
        code: "NESTED_TRASH_BATCH",
        trashBatchId: blockers.nestedBatchId,
      }
    : blockers.activeWorktreeReference
      ? { code: "ACTIVE_WORKTREE_RESOURCE_REFERENCE" }
      : null;
  return {
    id: batch.id,
    spaceId: batch.space_id,
    root: {
      id: batch.root_node_id,
      name: batch.root_name,
      resource:
        batch.root_resource_id &&
        batch.root_resource_kind === "univer" &&
        batch.root_unit_type
          ? {
              id: batch.root_resource_id,
              kind: "univer" as const,
              unitType: batch.root_unit_type,
            }
          : batch.root_resource_id &&
              batch.root_resource_kind === "blob" &&
              batch.root_media_type &&
              batch.root_byte_size !== null
            ? {
                id: batch.root_resource_id,
                kind: "blob" as const,
                mediaType: batch.root_media_type,
                byteSize: batch.root_byte_size,
              }
          : null,
    },
    originalLocation: {
      breadcrumbs: repository.originalBreadcrumbs(batch.root_node_id),
    },
    trashedBy: {
      id: batch.created_by,
      username: batch.creator_username,
      displayName: batch.creator_display_name,
      avatarUrl: batch.creator_avatar_url,
    },
    trashedAt: new Date(batch.created_at).toISOString(),
    nodeCount: batch.node_count,
    capabilities: {
      restore: restoreBlockedBy === null,
      removePermanently: removeBlockedBy === null,
    },
    restoreBlockedBy,
    removeBlockedBy,
  };
}

function validLimit(value: unknown): number {
  if (value === undefined) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw invalidInput(
      "limit must be an integer between 1 and 200.",
      "limit"
    );
  }
  return limit;
}

function decodeCursor(value: unknown): TrashCursor | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value) {
    throw invalidInput("cursor is invalid.", "cursor");
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<TrashCursor>;
    if (
      !Number.isSafeInteger(parsed.createdAt) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as TrashCursor;
  } catch {
    throw invalidInput("cursor is invalid.", "cursor");
  }
}

function encodeCursor(cursor: TrashCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "Trash Batch not found.");
}

function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "This action is not allowed."
  );
}
