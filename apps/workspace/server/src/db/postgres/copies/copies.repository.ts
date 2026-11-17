import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../../middleware/errors.js";
import type { CopiesRepository, CopyError, CopyOperationRow } from "../../../modules/copies/copies.repository.js";
import type { CopyPayload } from "../../../modules/copies/copies.types.js";
import type { UniverAssetRow } from "../../../modules/univer-assets/univer-assets.repository.js";
import { assertFileQuota, type PostgresAccessRepository } from "../access/access.repository.js";
import { requireResourceTarget } from "../access/resource-target.js";
import { insertReadyBlobResource } from "../blobs/blobs.repository.js";
import type { PostgresDatabase } from "../connection.js";

export class PostgresCopiesRepository implements CopiesRepository {
  constructor(
    private readonly _database: PostgresDatabase,
    private readonly access: PostgresAccessRepository,
  ) {}

  private async requireTarget(actorUserId: string, target: CopyPayload["target"]): Promise<void> {
    await requireResourceTarget(
      this.access,
      actorUserId,
      target.spaceId,
      target.kind === "worktree" ? target.parentNodeId : null,
      "The current user cannot perform this action.",
    );
  }

  async personalSpaceId(userId: string): Promise<string | null> {
    const row = await this._database
      .prepare("SELECT id FROM spaces WHERE type = 'personal' AND owner_user_id = ?")
      .get(userId) as { readonly id: string } | undefined;
    return row?.id ?? null;
  }

  async findTrunkAssets(ids: readonly string[]): Promise<UniverAssetRow[]> {
    return await this._database
      .prepare(
        `SELECT * FROM univer_assets
         WHERE worktree_id IS NULL AND id IN (SELECT jsonb_array_elements_text(?::jsonb))`
      )
      .all(JSON.stringify(ids)) as unknown as UniverAssetRow[];
  }

  async find(operationId: string): Promise<CopyOperationRow | null> {
    return await read(this._database, operationId);
  }

  async reserve(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CopyPayload;
    readonly createdAt: number;
  }): Promise<{ readonly created: boolean; readonly row: CopyOperationRow }> {
    return await this._database.transaction(async (database) => {
      const existing = await read(database, input.operationId);
      if (existing) return { created: false, row: existing };
      await this.requireTarget(input.actorUserId, input.payload.target);
      await assertFileQuota(database, input.actorUserId, 1, input.operationId);
      await database
        .prepare(
          `INSERT INTO operations
            (
              id, kind, actor_user_id, step, state, payload_json,
              attempt_count, next_attempt_at, lease_owner,
              lease_expires_at, created_at, updated_at
            )
           VALUES (?, 'copy_node', ?, 'reserved', 'pending', ?, 0, ?, 'product-api', ?, ?, ?)`
        )
        .run(
          input.operationId,
          input.actorUserId,
          JSON.stringify(input.payload),
          input.createdAt,
          input.createdAt + 60_000,
          input.createdAt,
          input.createdAt
        );
      return { created: true, row: (await read(database, input.operationId))! };
    });
  }

  async beginAttempt(operationId: string, attemptedAt: number): Promise<CopyOperationRow | null> {
    return (
      (await this._database
        .prepare(
          `UPDATE operations
           SET attempt_count = attempt_count + 1, updated_at = ?
           WHERE id = ? AND kind = 'copy_node' AND state = 'pending' RETURNING *`
        )
        .get(attemptedAt, operationId) as CopyOperationRow | undefined) ?? null
    );
  }

  async setStep(operationId: string, step: "objects_copied" | "unit_created", updatedAt: number): Promise<void> {
    await this._database
      .prepare(
        `UPDATE operations SET step = ?, updated_at = ?
         WHERE id = ? AND state = 'pending' AND step <> 'abandoning'`
      )
      .run(step, updatedAt, operationId);
  }

  async defer(input: {
    readonly operationId: string;
    readonly error: CopyError;
    readonly abandoning: boolean;
    readonly nextAttemptAt: number;
    readonly updatedAt: number;
  }): Promise<boolean> {
    return Boolean(
      await this._database
        .prepare(
          `UPDATE operations
           SET last_error_code = ?, last_error_message = ?,
               step = CASE WHEN ? = 1 THEN 'abandoning' ELSE step END,
               next_attempt_at = ?, lease_owner = NULL,
               lease_expires_at = NULL, updated_at = ?
           WHERE id = ? AND state = 'pending' RETURNING id`
        )
        .get(
          input.error.code,
          input.error.message,
          input.abandoning ? 1 : 0,
          input.nextAttemptAt,
          input.updatedAt,
          input.operationId
        )
    );
  }

  async claimDue(workerId: string, now: number, leaseExpiresAt: number, limit: number): Promise<CopyOperationRow[]> {
    return await this._database.transaction(async (database) => {
      const rows = await database
        .prepare(
          `SELECT * FROM operations
           WHERE kind = 'copy_node'
             AND state = 'pending'
             AND next_attempt_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY next_attempt_at, created_at LIMIT ?`
        )
        .all(now, now, limit) as unknown as CopyOperationRow[];
      const claim = database.prepare(
        `UPDATE operations
         SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ?`
      );
      for (const row of rows) await claim.run(workerId, leaseExpiresAt, now, row.id);
      return rows;
    });
  }

  async complete(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CopyPayload;
    readonly completedAt: number;
  }): Promise<CopyOperationRow> {
    const { payload, actorUserId, completedAt } = input;
    const { content, target } = payload;
    return await this._database.transaction(async (database) => {
      const operation = await read(database, input.operationId);
      if (operation?.state === "completed") return operation;
      if (operation?.state !== "pending" || operation.step === "abandoning") {
        throw new ApplicationError("CONFLICT", 409, "The copy was abandoned.");
      }
      await this.requireTarget(actorUserId, target);
      const insertAsset = database.prepare(
        `INSERT INTO univer_assets
          (
            id, unit_id, worktree_id, object_key, original_filename,
            media_type, byte_size, sha256, etag, created_by, created_at
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      if (content.kind === "blob") {
        await insertReadyBlobResource(database, {
          nodeId: payload.nodeId,
          resourceId: payload.resourceId,
          spaceId: target.spaceId,
          parentNodeId: null,
          name: payload.name,
          createdBy: actorUserId,
          ...content.object,
          now: completedAt,
        });
      } else if (target.kind === "space") {
        await database
          .prepare(
            `INSERT INTO nodes
              (id, space_id, parent_id, name, created_by, created_at, updated_at)
             VALUES (?, ?, NULL, ?, ?, ?, ?)`
          )
          .run(payload.nodeId, target.spaceId, payload.name, actorUserId, completedAt, completedAt);
        await database
          .prepare(
            `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
             VALUES (?, ?, 'univer', ?, ?)`
          )
          .run(payload.resourceId, payload.nodeId, completedAt, completedAt);
        await database
          .prepare(
            `INSERT INTO univer_resources (resource_id, unit_id, unit_type)
             VALUES (?, ?, ?)`
          )
          .run(payload.resourceId, content.unitId, content.unitType);
      } else {
        await database
          .prepare(
            `INSERT INTO worktree_units
              (worktree_id, unit_id, resource_id, source, ordinal, added_at)
             VALUES (
               ?, ?, ?, 'worktree',
               COALESCE(
                 (SELECT MAX(ordinal) + 1 FROM worktree_units WHERE worktree_id = ?),
                 0
               ),
               ?
             )`
          )
          .run(target.worktreeId, content.unitId, payload.resourceId, target.worktreeId, completedAt);
        await database
          .prepare(
            `INSERT INTO worktree_node_intents
              (
                worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
                name, unit_type, created_by, created_at, updated_at, copied_from_node_id
              )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            target.worktreeId,
            content.unitId,
            payload.nodeId,
            target.spaceId,
            target.parentNodeId,
            payload.name,
            content.unitType,
            actorUserId,
            completedAt,
            completedAt,
            payload.sourceNodeId
          );
      }
      if (target.kind === "space") {
        // The subquery drops the link when the source was purged while the copy was running.
        await database
          .prepare("UPDATE nodes SET copied_from_node_id = (SELECT id FROM nodes WHERE id = ?) WHERE id = ?")
          .run(payload.sourceNodeId, payload.nodeId);
      }
      if (content.kind === "univer") {
        for (const asset of content.assets) {
          await insertAsset.run(
            asset.assetId,
            content.unitId,
            target.kind === "worktree" ? target.worktreeId : null,
            asset.objectKey,
            asset.originalFilename,
            asset.mediaType,
            asset.byteSize,
            asset.sha256,
            asset.etag,
            actorUserId,
            completedAt
          );
        }
      }
      await database
        .prepare(
          `UPDATE operations
           SET step = 'completed', state = 'completed', result_json = ?,
               last_error_code = NULL, last_error_message = NULL,
               lease_owner = NULL, lease_expires_at = NULL,
               updated_at = ?, completed_at = ?
           WHERE id = ?`
        )
        .run(
          JSON.stringify({
            nodeId: payload.nodeId,
            resourceId: payload.resourceId,
            ...(content.kind === "univer" ? { unitId: content.unitId } : {}),
            ...(target.kind === "worktree" ? { worktreeId: target.worktreeId } : {}),
          }),
          completedAt,
          completedAt,
          input.operationId
        );
      return (await read(database, input.operationId))!;
    });
  }

  async fail(operationId: string, payload: CopyPayload, failedAt: number): Promise<void> {
    await this._database.transaction(async (database) => {
      const failed = await database
        .prepare(
          `UPDATE operations
           SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE id = ? AND state = 'pending' RETURNING id`
        )
        .get(failedAt, operationId);
      if (!failed) return;
      const enqueue = database.prepare(
        `INSERT INTO object_deletion_jobs
          (id, object_key, reason, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (object_key) DO NOTHING`
      );
      const { content } = payload;
      const objects = content.kind === "blob" ? [content.object] : content.assets;
      for (const object of objects) {
        await enqueue.run(
          randomUUID(),
          object.objectKey,
          content.kind === "blob" ? "blob_upload_abandoned" : "univer_asset_upload_abandoned",
          failedAt,
          failedAt,
          failedAt
        );
      }
    });
  }
}

async function read(database: PostgresDatabase, operationId: string): Promise<CopyOperationRow | null> {
  return (
    (await database.prepare("SELECT * FROM operations WHERE id = ?").get(operationId) as CopyOperationRow | undefined) ?? null
  );
}
