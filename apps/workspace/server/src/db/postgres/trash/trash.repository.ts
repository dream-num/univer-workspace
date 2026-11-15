import type { NodeAccess } from "../../../modules/access/index.js";
import { trashBatchMismatch, trashForbidden, trashNotFound } from "../../../modules/trash/trash.errors.js";
import { assertFileQuota, type PostgresAccessRepository } from "../access/access.repository.js";
import { randomUUID } from "node:crypto";
import type { PostgresDatabase } from "../connection.js";
import type {
  TrashCursor,
  TrashBatchRow,
  TrashBreadcrumbRow,
  TrashBlockers,
  TrashRepository,
} from "../../../modules/trash/trash.repository.js";

export class PostgresTrashRepository implements TrashRepository {
  constructor(private readonly _database: PostgresDatabase, private readonly access: PostgresAccessRepository) {}

  async trashNode(input: {
    readonly batchId: string;
    readonly nodeId: string;
    readonly createdBy: string;
    readonly createdAt: number;
  }): Promise<void> {
    await this._database.transaction(async (database) => {
      const existing = await database
        .prepare("SELECT root_node_id, created_by FROM trash_batches WHERE id = ?")
        .get(input.batchId) as
        | {
            readonly root_node_id: string;
            readonly created_by: string;
          }
        | undefined;
      if (existing) {
        if (
          existing.root_node_id !== input.nodeId ||
          existing.created_by !== input.createdBy
        ) {
          throw trashBatchMismatch();
        }
        return;
      }
      const node = await this.access.readNodeAccess(input.createdBy, input.nodeId);
      if (!node) throw trashNotFound();
      if (!node.capabilities.trash) throw trashForbidden();
      await database
        .prepare(
          `INSERT INTO trash_batches
            (id, space_id, root_node_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          input.batchId,
          node.spaceId,
          input.nodeId,
          input.createdBy,
          input.createdAt
        );
      await database
        .prepare(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM nodes WHERE id = ?
             UNION ALL
             SELECT child.id
             FROM nodes AS child
             JOIN descendants ON child.parent_id = descendants.id
           )
           UPDATE nodes
           SET trash_batch_id = ?, updated_at = ?
           WHERE id IN (SELECT id FROM descendants)
             AND trash_batch_id IS NULL`
        )
        .run(input.nodeId, input.batchId, input.createdAt);
    });
  }

  async findBatch(batchId: string): Promise<TrashBatchRow | null> {
    return (
      (await this._database
        .prepare(
          `${batchSelect()}
           WHERE batch.id = ?`
        )
        .get(batchId) as TrashBatchRow | undefined) ?? null
    );
  }

  async listBatches(
    spaceId: string,
    cursor: TrashCursor | null,
    limit: number
  ): Promise<TrashBatchRow[]> {
    const cursorClause =
      cursor === null
        ? ""
        : `AND (
             batch.created_at < ?
             OR (batch.created_at = ? AND batch.id > ?)
           )`;
    const parameters =
      cursor === null
        ? [spaceId, limit]
        : [
            spaceId,
            cursor.createdAt,
            cursor.createdAt,
            cursor.id,
            limit,
          ];
    return await this._database
      .prepare(
        `${batchSelect()}
         WHERE batch.space_id = ?
           AND batch.restored_at IS NULL
           ${cursorClause}
         ORDER BY batch.created_at DESC, batch.id
         LIMIT ?`
      )
      .all(...parameters) as unknown as TrashBatchRow[];
  }

  async originalBreadcrumbs(rootNodeId: string): Promise<TrashBreadcrumbRow[]> {
    return await this._database
      .prepare(
        `WITH RECURSIVE ancestry(id, parent_id, name, depth) AS (
           SELECT parent.id, parent.parent_id, parent.name, 0
           FROM nodes AS root
           JOIN nodes AS parent ON parent.id = root.parent_id
           WHERE root.id = ?
           UNION ALL
           SELECT parent.id, parent.parent_id, parent.name, ancestry.depth + 1
           FROM nodes AS parent
           JOIN ancestry ON ancestry.parent_id = parent.id
         )
         SELECT id, name
         FROM ancestry
         ORDER BY depth DESC`
      )
      .all(rootNodeId) as unknown as TrashBreadcrumbRow[];
  }

  async blockers(batch: TrashBatchRow): Promise<TrashBlockers> {
    return await this.readBlockers(batch);
  }

  private async readBlockers(batch: TrashBatchRow): Promise<TrashBlockers> {
    const parent = await this._database
      .prepare(
        `WITH RECURSIVE ancestry(id, parent_id, trash_batch_id) AS (
           SELECT parent.id, parent.parent_id, parent.trash_batch_id
           FROM nodes AS root
           JOIN nodes AS parent ON parent.id = root.parent_id
           WHERE root.id = ?
           UNION ALL
           SELECT parent.id, parent.parent_id, parent.trash_batch_id
           FROM nodes AS parent
           JOIN ancestry ON ancestry.parent_id = parent.id
         )
         SELECT trash_batch_id
         FROM ancestry
         WHERE trash_batch_id IS NOT NULL
         ORDER BY id
         LIMIT 1`
      )
      .get(batch.root_node_id) as
      | { readonly trash_batch_id: string }
      | undefined;
    const nested = await this._database
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT child.id
           FROM nodes AS child
           JOIN descendants ON child.parent_id = descendants.id
         )
         SELECT nested.id
         FROM trash_batches AS nested
         WHERE nested.id <> ?
           AND nested.restored_at IS NULL
           AND nested.root_node_id IN (SELECT id FROM descendants)
         ORDER BY nested.created_at DESC, nested.id
         LIMIT 1`
      )
      .get(batch.root_node_id, batch.id) as
      | { readonly id: string }
      | undefined;
    const activeReference = await this._database
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL
           SELECT child.id
           FROM nodes AS child
           JOIN descendants ON child.parent_id = descendants.id
         )
         SELECT 1
         FROM worktree_units AS worktree_unit
         JOIN worktrees AS worktree ON worktree.id = worktree_unit.worktree_id
         WHERE worktree.processed_at IS NULL
           AND worktree_unit.resource_id IN (
             SELECT resource.id
             FROM resources AS resource
             WHERE resource.node_id IN (SELECT id FROM descendants)
           )
         LIMIT 1`
      )
      .get(batch.root_node_id);
    return {
      parentBatchId: parent?.trash_batch_id ?? null,
      nestedBatchId: nested?.id ?? null,
      activeWorktreeReference: Boolean(activeReference),
    };
  }

  /** Nodes with a Resource that restoring the batch brings back. */
  private async countFiles(batch: TrashBatchRow): Promise<number> {
    const row = await this._database
      .prepare(
        `SELECT COUNT(*) AS files
         FROM resources
         JOIN nodes ON nodes.id = resources.node_id
         WHERE nodes.trash_batch_id = ?`
      )
      .get(batch.id) as { readonly files: number };
    return row.files;
  }

  private async requireManageableBatch(batchId: string, userId: string): Promise<TrashBatchRow> {
    const batch = await this._database.prepare(`
      ${batchSelect()} WHERE batch.id = ? AND batch.restored_at IS NULL AND root.trash_batch_id = batch.id
    `).get(batchId) as TrashBatchRow | undefined;
    if (!batch || !(await this.access.readSpaceAccess(userId, batch.space_id))?.capabilities.viewTrash) throw trashNotFound();
    return batch;
  }

  async restore(batchId: string, userId: string, restoredAt: number): Promise<NodeAccess | null> {
    return await this._database.transaction(async (database) => {
      const batch = await this.requireManageableBatch(batchId, userId);
      if ((await this.readBlockers(batch)).parentBatchId) return null;
      await assertFileQuota(database, userId, await this.countFiles(batch));
      await database
        .prepare(
          `UPDATE nodes
           SET trash_batch_id = NULL, updated_at = ?
           WHERE trash_batch_id = ?`
        )
        .run(restoredAt, batch.id);
      await database
        .prepare(
          `UPDATE trash_batches
           SET restored_at = ?
           WHERE id = ? AND restored_at IS NULL`
        )
        .run(restoredAt, batch.id);
      const restored = await this.access.readNodeAccess(userId, batch.root_node_id);
      if (!restored) throw new Error("Restored Node is not discoverable");
      return restored;
    });
  }

  async removePermanently(batchId: string, userId: string, deletedAt: number): Promise<"removed" | "nestedBatch" | "activeWorktreeReference"> {
    return await this._database.transaction(async (database) => {
      const batch = await this.requireManageableBatch(batchId, userId);
      const blockers = await this.readBlockers(batch);
      if (blockers.nestedBatchId) return "nestedBatch";
      if (blockers.activeWorktreeReference) return "activeWorktreeReference";
      const blobRows = await database
        .prepare(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM nodes WHERE id = ?
             UNION ALL
             SELECT child.id
             FROM nodes AS child
             JOIN descendants ON child.parent_id = descendants.id
           )
           SELECT blob.object_key
           FROM resources AS resource
           JOIN blob_resources AS blob ON blob.resource_id = resource.id
           WHERE resource.node_id IN (SELECT id FROM descendants)`
        )
        .all(batch.root_node_id) as unknown as Array<{
        readonly object_key: string;
      }>;
      const assetRows = await database
        .prepare(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM nodes WHERE id = ?
             UNION ALL
             SELECT child.id
             FROM nodes AS child
             JOIN descendants ON child.parent_id = descendants.id
           )
           SELECT asset.id, asset.object_key
           FROM resources AS resource
           JOIN univer_resources AS univer
             ON univer.resource_id = resource.id
           JOIN univer_assets AS asset
             ON asset.unit_id = univer.unit_id
            AND asset.worktree_id IS NULL
           WHERE resource.node_id IN (SELECT id FROM descendants)`
        )
        .all(batch.root_node_id) as unknown as Array<{
        readonly id: string;
        readonly object_key: string;
      }>;
      const enqueueDeletion = database.prepare(
        `INSERT INTO object_deletion_jobs
          (id, object_key, reason, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (object_key) DO NOTHING`
      );
      for (const blob of blobRows) {
        await enqueueDeletion.run(
          randomUUID(),
          blob.object_key,
          "blob_resource_deleted",
          deletedAt,
          deletedAt,
          deletedAt
        );
      }
      const removeAsset = database.prepare(
        "DELETE FROM univer_assets WHERE id = ? AND worktree_id IS NULL"
      );
      for (const asset of assetRows) {
        await enqueueDeletion.run(
          randomUUID(),
          asset.object_key,
          "univer_unit_deleted",
          deletedAt,
          deletedAt,
          deletedAt
        );
        await removeAsset.run(asset.id);
      }
      const rows = await database
        .prepare(
          `WITH RECURSIVE descendants(id, depth) AS (
             SELECT id, 0 FROM nodes WHERE id = ?
             UNION ALL
             SELECT child.id, descendants.depth + 1
             FROM nodes AS child
             JOIN descendants ON child.parent_id = descendants.id
           )
           SELECT id
           FROM descendants
           ORDER BY depth DESC`
        )
        .all(batch.root_node_id) as unknown as Array<{
        readonly id: string;
      }>;
      const remove = database.prepare(
        "DELETE FROM nodes WHERE id = ?"
      );
      for (const row of rows) await remove.run(row.id);
      await database
        .prepare("DELETE FROM trash_batches WHERE id = ?")
        .run(batch.id);
      return "removed";
    });
  }
}

function batchSelect(): string {
  return `SELECT
            batch.id,
            batch.space_id,
            batch.root_node_id,
            batch.created_by,
            batch.created_at,
            batch.restored_at,
            resource.id AS root_resource_id,
            resource.kind AS root_resource_kind,
            root.name AS root_name,
            univer_resource.unit_type AS root_unit_type,
            blob_resource.media_type AS root_media_type,
            blob_resource.byte_size AS root_byte_size,
            creator.username AS creator_username,
            creator.display_name AS creator_display_name,
            creator.avatar_url AS creator_avatar_url,
            (
              SELECT COUNT(*)
              FROM nodes AS batched_node
              WHERE batched_node.trash_batch_id = batch.id
            ) AS node_count
          FROM trash_batches AS batch
          JOIN nodes AS root ON root.id = batch.root_node_id
          LEFT JOIN resources AS resource ON resource.node_id = root.id
          LEFT JOIN univer_resources AS univer_resource
            ON univer_resource.resource_id = resource.id
          LEFT JOIN blob_resources AS blob_resource
            ON blob_resource.resource_id = resource.id
          JOIN users AS creator ON creator.id = batch.created_by`;
}
