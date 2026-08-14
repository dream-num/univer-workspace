import { randomUUID } from "node:crypto";
import type { WorkspaceDatabase } from "../../db/database.js";
import type { UnitType } from "../access/index.js";

export interface TrashCursor {
  readonly createdAt: number;
  readonly id: string;
}

export interface TrashBatchRow {
  readonly id: string;
  readonly space_id: string;
  readonly root_node_id: string;
  readonly created_by: string;
  readonly created_at: number;
  readonly restored_at: number | null;
  readonly root_resource_id: string | null;
  readonly root_resource_kind: "univer" | "blob" | null;
  readonly root_name: string;
  readonly root_unit_type: UnitType | null;
  readonly root_media_type: string | null;
  readonly root_byte_size: number | null;
  readonly creator_username: string;
  readonly creator_display_name: string;
  readonly creator_avatar_url: string | null;
  readonly node_count: number;
}

export interface TrashBreadcrumbRow {
  readonly id: string;
  readonly name: string;
}

export interface TrashBlockers {
  readonly parentBatchId: string | null;
  readonly nestedBatchId: string | null;
  readonly activeWorktreeReference: boolean;
}

export class TrashRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  trashNode(input: {
    readonly batchId: string;
    readonly nodeId: string;
    readonly spaceId: string;
    readonly createdBy: string;
    readonly createdAt: number;
  }): void {
    this._database.transaction((database) => {
      database
        .prepare(
          `INSERT INTO trash_batches
            (id, space_id, root_node_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          input.batchId,
          input.spaceId,
          input.nodeId,
          input.createdBy,
          input.createdAt
        );
      database
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

  findBatch(batchId: string): TrashBatchRow | null {
    return (
      (this._database.connection
        .prepare(
          `${batchSelect()}
           WHERE batch.id = ?`
        )
        .get(batchId) as TrashBatchRow | undefined) ?? null
    );
  }

  listBatches(
    spaceId: string,
    cursor: TrashCursor | null,
    limit: number
  ): TrashBatchRow[] {
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
    return this._database.connection
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

  originalBreadcrumbs(rootNodeId: string): TrashBreadcrumbRow[] {
    return this._database.connection
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

  blockers(batch: TrashBatchRow): TrashBlockers {
    const parent = this._database.connection
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
    const nested = this._database.connection
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
    const activeReference = this._database.connection
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

  restore(batch: TrashBatchRow, restoredAt: number): void {
    this._database.transaction((database) => {
      database
        .prepare(
          `UPDATE nodes
           SET trash_batch_id = NULL, updated_at = ?
           WHERE trash_batch_id = ?`
        )
        .run(restoredAt, batch.id);
      database
        .prepare(
          `UPDATE trash_batches
           SET restored_at = ?
           WHERE id = ? AND restored_at IS NULL`
        )
        .run(restoredAt, batch.id);
    });
  }

  removePermanently(batch: TrashBatchRow, deletedAt: number): void {
    this._database.transaction((database) => {
      const blobRows = database
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
      const assetRows = database
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
        enqueueDeletion.run(
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
        enqueueDeletion.run(
          randomUUID(),
          asset.object_key,
          "univer_unit_deleted",
          deletedAt,
          deletedAt,
          deletedAt
        );
        removeAsset.run(asset.id);
      }
      const rows = database
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
      for (const row of rows) remove.run(row.id);
      database
        .prepare("DELETE FROM trash_batches WHERE id = ?")
        .run(batch.id);
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
