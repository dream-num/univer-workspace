import { trashNotFound } from "./trash.errors.js";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import { nodeSummary } from "../nodes/nodes.service.js";
import type {
  TrashRepository,
  TrashBatchRow,
  TrashCursor,
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

  async function assertChangesBatchSpace(userId: string, trashBatchId: string): Promise<void> {
    const batch = await options.repository.findBatch(trashBatchId);
    if (batch) await options.access.assertChangesTrunk(userId, batch.space_id);
  }

  return {
    async trashNode(userId, nodeId) {
      const node = await options.access.resolveNode(userId, nodeId);
      if (node) await options.access.assertChangesTrunk(userId, node.spaceId);
      const batchId = randomUUID();
      await options.repository.trashNode({ batchId, nodeId, createdBy: userId, createdAt: now() });
      const batch = await options.repository.findBatch(batchId);
      if (!batch) throw new Error("Created Trash Batch is missing");
      return batchView(batch, options.repository);
    },

    async trashNodeOnce(userId, nodeId, batchId) {
      await options.repository.trashNode({ batchId, nodeId, createdBy: userId, createdAt: now() });
    },

    async list(userId, spaceId, page) {
      const space = await options.access.resolveSpace(userId, spaceId);
      if (!space) throw trashNotFound();
      if (!space.capabilities.viewTrash) throw trashNotFound();
      const limit = validLimit(page.limit);
      const rows = await options.repository.listBatches(
        spaceId,
        decodeCursor(page.cursor),
        limit + 1
      );
      const hasNext = rows.length > limit;
      const items = hasNext ? rows.slice(0, limit) : rows;
      const last = items.at(-1);
      return {
        items: await Promise.all(items.map((batch) =>
          batchView(batch, options.repository)
        )),
        nextCursor:
          hasNext && last
            ? encodeCursor({ createdAt: last.created_at, id: last.id })
            : null,
      };
    },

    async restore(userId, trashBatchId) {
      await assertChangesBatchSpace(userId, trashBatchId);
      const restored = await options.repository.restore(trashBatchId, userId, now());
      if (restored === null) {
        throw new ApplicationError(
          "RESTORE_PARENT_IN_TRASH",
          409,
          "Restore the parent Trash Batch first."
        );
      }
      return nodeSummary(restored);
    },

    async removePermanently(userId, trashBatchId) {
      await assertChangesBatchSpace(userId, trashBatchId);
      const result = await options.repository.removePermanently(trashBatchId, userId, now());
      if (result === "nestedBatch") {
        throw new ApplicationError(
          "NESTED_TRASH_BATCH",
          409,
          "Remove or restore the nested Trash Batch first."
        );
      }
      if (result === "activeWorktreeReference") {
        throw new ApplicationError(
          "ACTIVE_WORKTREE_RESOURCE_REFERENCE",
          409,
          "An active Worktree references this content."
        );
      }
    },
  };
}

async function batchView(
  batch: TrashBatchRow,
  repository: TrashRepository
): Promise<TrashBatchView> {
  const blockers = await repository.blockers(batch);
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
      breadcrumbs: await repository.originalBreadcrumbs(batch.root_node_id),
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
