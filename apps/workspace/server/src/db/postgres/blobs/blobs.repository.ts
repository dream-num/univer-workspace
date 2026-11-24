import type { Principal } from "../../../modules/identity/index.js";
import { ApplicationError } from "../../../middleware/errors.js";
import { assertNotDelegatedPageWrite } from "../../../modules/blobs/html-view-guard.js";
import { requireResourceTarget } from "../access/resource-target.js";
import { assertFileQuota, type PostgresAccessRepository } from "../access/access.repository.js";
import type { OperationView } from "../../../modules/resources/index.js";
import { randomUUID } from "node:crypto";
import type { BlobReplacementResult } from "../../../modules/blobs/blobs.types.js";
import type { StoredBlob } from "../../../integrations/blob/blob-store.js";
import type { PostgresDatabase } from "../connection.js";
import {
  type BlobReplacementIntent,
  type BlobUploadIntent,
  type BlobUploadPayload,
  type BlobUploadRow,
  type ReservedBlobUpload,
  type BlobDeletionJobRow,
  BlobReplacementConflictError,
  BlobReservationConflictError,
  BlobUploadStateConflictError,
  type BlobsRepository,
} from "../../../modules/blobs/blobs.repository.js";

interface BlobOperationRow {
  readonly id: string;
  readonly kind: "create_blob_resource";
  readonly actor_user_id: string;
  readonly state: "pending" | "completed" | "failed";
  readonly payload_json: string;
  readonly result_json: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export class PostgresBlobsRepository implements BlobsRepository {
  constructor(
    private readonly _database: PostgresDatabase,
    private readonly access: PostgresAccessRepository,
  ) {}

  private async requireWritable(actor: Principal, resourceId: string) {
    const resource = await this.access.readResourceAccess(actor.user.id, resourceId);
    if (!resource || resource.kind !== "blob") throw new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
    if (!resource.capabilities.editContent) throw new ApplicationError("FORBIDDEN", 403, "This action is not allowed.");
    assertNotDelegatedPageWrite(actor, [resource.node.name, resource.originalFilename]);
    if (resource.availability !== "ready") throw new ApplicationError("CONFLICT", 409, "Blob content is not currently available.");
    return resource;
  }

  async reserveReplacement(
    operationId: string,
    actor: Principal,
    intent: BlobReplacementIntent,
    now: number,
  ): Promise<{ readonly objectKey: string; readonly currentEtag: string; readonly result: BlobReplacementResult | null }> {
    return await this._database.transaction(async (database) => {
      const userId = actor.user.id;
      const { etag: currentEtag } = await this.requireWritable(actor, intent.resourceId);
      const existing = await database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(operationId) as
        | {
            kind: string;
            actor_user_id: string;
            payload_json: string;
            result_json: string | null;
            state: string;
          }
        | undefined;
      if (existing) {
        const payload = JSON.parse(existing.payload_json);
        if (
          existing.kind !== "replace_blob_content" ||
          existing.actor_user_id !== userId ||
          payload.resourceId !== intent.resourceId ||
          payload.expectedEtag !== intent.expectedEtag ||
          payload.byteSize !== intent.byteSize
        ) {
          throw new BlobReplacementConflictError("intent");
        }
        if (existing.state !== "completed") {
          throw new BlobReplacementConflictError("state");
        }
        return {
          objectKey: payload.objectKey,
          currentEtag,
          result: JSON.parse(existing.result_json!) as BlobReplacementResult,
        };
      }
      const objectKey = randomUUID();
      await database
        .prepare(`INSERT INTO operations
        (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES (?, 'replace_blob_content', ?, 'receiving', 'pending', ?, 0, ?, ?, ?)`)
        .run(operationId, userId, JSON.stringify({ ...intent, objectKey }), now, now, now);
      return { objectKey, currentEtag, result: null };
    });
  }

  async completeReplacement(
    operationId: string,
    actor: Principal,
    intent: BlobReplacementIntent,
    objectKey: string,
    stored: StoredBlob,
    now: number,
  ): Promise<BlobReplacementResult> {
    return await this._database.transaction(async (database) => {
      await this.requireWritable(actor, intent.resourceId);
      const swapped = await swapBlobContent(database, { ...intent, objectKey, stored, now });
      if (swapped === "etag-mismatch") throw new BlobReplacementConflictError("etag");
      const { etag } = swapped;
      const result = { operationId, resourceId: intent.resourceId, etag: `"${etag}"` };
      const { changes } = await database
        .prepare(`UPDATE operations SET state = 'completed', step = 'completed', result_json = ?,
        updated_at = ?, completed_at = ? WHERE id = ? AND state = 'pending'`)
        .run(JSON.stringify(result), now, now, operationId);
      // Maintenance already failed it and queued the new object for deletion, so keep the old one.
      if (changes !== 1) throw new BlobReplacementConflictError("state");
      return result;
    });
  }

  async failReplacement(operationId: string, code: string, message: string, now: number): Promise<void> {
    await this._database.transaction(async (database) => {
      const row = await database
        .prepare(
          "SELECT payload_json FROM operations WHERE id = ? AND kind = 'replace_blob_content' AND state <> 'completed'",
        )
        .get(operationId) as { payload_json: string } | undefined;
      if (!row) return;
      // A request whose lease lapsed finds its replacement already failed; the bytes it stored late still need deleting.
      await database
        .prepare(
          `UPDATE operations SET state = 'failed', last_error_code = ?, last_error_message = ?, updated_at = ?
          WHERE id = ? AND state = 'pending'`,
        )
        .run(code, message, now, operationId);
      await database
        .prepare(`INSERT INTO object_deletion_jobs (id, object_key, reason, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, 'blob_upload_abandoned', ?, ?, ?) ON CONFLICT (object_key) DO NOTHING`)
        .run(randomUUID(), JSON.parse(row.payload_json).objectKey, now, now, now);
    });
  }

  async pendingReplacementIds(renewedBefore: number): Promise<string[]> {
    const rows = await this._database
      .prepare(
        "SELECT id FROM operations WHERE kind = 'replace_blob_content' AND state = 'pending' AND updated_at <= ?",
      )
      .all(renewedBefore) as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  async renewReplacement(operationId: string, renewedAt: number): Promise<void> {
    await this._database
      .prepare("UPDATE operations SET updated_at = ? WHERE id = ? AND kind = 'replace_blob_content' AND state = 'pending'")
      .run(renewedAt, operationId);
  }

  async reserve(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly intent: BlobUploadIntent;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): Promise<ReservedBlobUpload> {
    return await this._database.transaction(async (database) => {
      await requireResourceTarget(this.access, input.actorUserId, input.intent.spaceId, input.intent.parentNodeId, "This action is not allowed.");
      await assertFileQuota(database, input.actorUserId, 1, input.operationId);
      const existing = await database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(input.operationId) as BlobOperationRow | undefined;
      if (existing) {
        if (existing.kind !== "create_blob_resource") {
          throw new BlobReservationConflictError(
            "Idempotency-Key is already associated with another request."
          );
        }
        const upload = await database
          .prepare("SELECT * FROM blob_upload_sessions WHERE operation_id = ?")
          .get(input.operationId) as BlobUploadRow | undefined;
        if (!upload) {
          throw new BlobReservationConflictError(
            "Idempotency-Key is already associated with another request."
          );
        }
        return {
          created: false,
          operation: blobOperationView(existing),
          actorUserId: existing.actor_user_id,
          upload,
          payload: JSON.parse(existing.payload_json) as BlobUploadPayload,
        };
      }
      const payload: BlobUploadPayload = {
        ...input.intent,
        uploadSessionId: randomUUID(),
        nodeId: randomUUID(),
        resourceId: randomUUID(),
        objectKey: randomUUID(),
      };
      await database.prepare(
        `INSERT INTO operations
          (id, kind, actor_user_id, step, state, payload_json, result_json,
           attempt_count, next_attempt_at, created_at, updated_at)
         VALUES (?, 'create_blob_resource', ?, 'awaiting_upload', 'pending', ?,
                 NULL, 0, ?, ?, ?)`
      ).run(
        input.operationId,
        input.actorUserId,
        JSON.stringify(payload),
        input.createdAt,
        input.createdAt,
        input.createdAt
      );
      await database.prepare(
        `INSERT INTO blob_upload_sessions
          (id, operation_id, actor_user_id, target_space_id,
           target_parent_node_id, node_id, resource_id, object_key, node_name,
           original_filename, declared_media_type, byte_size, state,
           expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting_for_upload',
                 ?, ?, ?)`
      ).run(
        payload.uploadSessionId,
        input.operationId,
        input.actorUserId,
        payload.spaceId,
        payload.parentNodeId,
        payload.nodeId,
        payload.resourceId,
        payload.objectKey,
        payload.name,
        payload.originalFilename,
        payload.declaredMediaType,
        payload.byteSize,
        input.expiresAt,
        input.createdAt,
        input.createdAt
      );
      return { ...await this.requireByOperation(input.operationId), created: true };
    });
  }

  async find(uploadId: string, actorUserId: string): Promise<ReservedBlobUpload | null> {
    const upload = await this._database.prepare(
      "SELECT * FROM blob_upload_sessions WHERE id = ? AND actor_user_id = ?"
    ).get(uploadId, actorUserId) as BlobUploadRow | undefined;
    if (!upload) return null;
    return await this.requireByOperation(upload.operation_id);
  }

  async recoverInterruptedUploads(recoveredAt: number, renewedBefore: number): Promise<number> {
    return Number((await this._database.prepare(
      `UPDATE blob_upload_sessions
       SET state = 'waiting_for_upload', updated_at = ?,
           last_error_code = 'UPLOAD_INTERRUPTED',
           last_error_message = 'The server restarted while receiving content.'
       WHERE state = 'verifying' AND updated_at <= ?`
    ).run(recoveredAt, renewedBefore)).changes);
  }

  async renewUpload(uploadId: string, renewedAt: number): Promise<void> {
    await this._database.prepare(
      "UPDATE blob_upload_sessions SET updated_at = ? WHERE id = ? AND state = 'verifying'"
    ).run(renewedAt, uploadId);
  }

  async beginUpload(uploadId: string, updatedAt: number): Promise<boolean> {
    const result = await this._database.prepare(
      `UPDATE blob_upload_sessions
       SET state = 'verifying', updated_at = ?, last_error_code = NULL,
           last_error_message = NULL
       WHERE id = ? AND state = 'waiting_for_upload'`
    ).run(updatedAt, uploadId);
    return result.changes === 1;
  }

  async markUploaded(input: {
    readonly uploadId: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly etag: string;
    readonly mediaType: string;
    readonly updatedAt: number;
  }): Promise<BlobUploadRow> {
    const result = await this._database.prepare(
      `UPDATE blob_upload_sessions
       SET state = 'uploaded', received_size = ?, sha256 = ?, etag = ?,
           detected_media_type = ?, updated_at = ?, last_error_code = NULL,
           last_error_message = NULL
       WHERE id = ? AND state = 'verifying'`
    ).run(
      input.byteSize,
      input.sha256,
      input.etag,
      input.mediaType,
      input.updatedAt,
      input.uploadId
    );
    if (result.changes !== 1) {
      throw new BlobUploadStateConflictError(
        "Blob Upload Session changed while content was being received."
      );
    }
    return await this.requireUpload(input.uploadId);
  }

  async resetUploadAfterFailure(
    uploadId: string,
    message: string,
    updatedAt: number
  ): Promise<void> {
    await this._database.prepare(
      `UPDATE blob_upload_sessions
       SET state = 'waiting_for_upload', updated_at = ?,
           last_error_code = 'UPLOAD_FAILED', last_error_message = ?
       WHERE id = ? AND state = 'verifying'`
    ).run(updatedAt, message, uploadId);
  }

  async complete(uploadId: string, completedAt: number): Promise<ReservedBlobUpload> {
    return await this._database.transaction(async (database) => {
      const upload = await this.requireUpload(uploadId);
      if (upload.state === "completed") {
        return await this.requireByOperation(upload.operation_id);
      }
      if (
        upload.state !== "uploaded" ||
        upload.received_size !== upload.byte_size ||
        !upload.sha256 ||
        !upload.etag ||
        !upload.detected_media_type
      ) throw new Error("Blob Upload Session is not ready to complete.");
      await requireResourceTarget(this.access, upload.actor_user_id, upload.target_space_id, upload.target_parent_node_id, "This action is not allowed.");
      await database.prepare(
        `UPDATE blob_upload_sessions
         SET state = 'verifying', updated_at = ? WHERE id = ?`
      ).run(completedAt, uploadId);
      await insertReadyBlobResource(database, {
        nodeId: upload.node_id, resourceId: upload.resource_id, spaceId: upload.target_space_id,
        parentNodeId: upload.target_parent_node_id, name: upload.node_name, createdBy: upload.actor_user_id,
        originalFilename: upload.original_filename, objectKey: upload.object_key, mediaType: upload.detected_media_type,
        byteSize: upload.byte_size, sha256: upload.sha256, etag: upload.etag, now: completedAt,
      });
      const result = JSON.stringify({
        nodeId: upload.node_id,
        resourceId: upload.resource_id,
      });
      await database.prepare(
        `UPDATE blob_upload_sessions
         SET state = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(completedAt, completedAt, uploadId);
      await database.prepare(
        `UPDATE operations
         SET step = 'completed', state = 'completed', result_json = ?,
             updated_at = ?, completed_at = ?
         WHERE id = ?`
      ).run(result, completedAt, completedAt, upload.operation_id);
      return await this.requireByOperation(upload.operation_id);
    });
  }

  async abort(uploadId: string, abortedAt: number): Promise<boolean> {
    return await this._database.transaction(async (database) => {
      const upload = await this.requireUpload(uploadId);
      if (upload.state === "aborted") return true;
      const { changes } = await database.prepare(
        `UPDATE blob_upload_sessions
         SET state = 'aborted', updated_at = ?
         WHERE id = ?
           AND state IN ('waiting_for_upload', 'uploaded', 'verifying')`
      ).run(abortedAt, uploadId);
      if (!changes) return false;
      await database.prepare(
        `UPDATE operations
         SET state = 'failed', last_error_code = 'UPLOAD_ABORTED',
             last_error_message = 'Blob upload was aborted.', updated_at = ?
         WHERE id = ? AND state = 'pending'`
      ).run(abortedAt, upload.operation_id);
      await database.prepare(
        `INSERT INTO object_deletion_jobs
          (id, object_key, reason, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, 'blob_upload_abandoned', ?, ?, ?)
         ON CONFLICT (object_key) DO NOTHING`
      ).run(randomUUID(), upload.object_key, abortedAt, abortedAt, abortedAt);
      return true;
    });
  }

  async expireDue(expiredAt: number, limit: number): Promise<number> {
    return await this._database.transaction(async (database) => {
      const rows = await database.prepare(
        `SELECT id, operation_id, object_key
         FROM blob_upload_sessions
         WHERE state IN ('waiting_for_upload', 'uploaded', 'verifying')
           AND expires_at <= ?
         ORDER BY expires_at, id
         LIMIT ?`
      ).all(expiredAt, limit) as unknown as Array<{
        readonly id: string;
        readonly operation_id: string;
        readonly object_key: string;
      }>;
      const updateUpload = database.prepare(
        `UPDATE blob_upload_sessions
         SET state = 'expired', updated_at = ?,
             last_error_code = 'UPLOAD_EXPIRED',
             last_error_message = 'Blob upload expired before publication.'
         WHERE id = ? AND state IN ('waiting_for_upload', 'uploaded', 'verifying')`
      );
      const updateOperation = database.prepare(
        `UPDATE operations
         SET state = 'failed', updated_at = ?,
             last_error_code = 'UPLOAD_EXPIRED',
             last_error_message = 'Blob upload expired before publication.'
         WHERE id = ? AND state = 'pending'`
      );
      const insertJob = database.prepare(
        `INSERT INTO object_deletion_jobs
          (id, object_key, reason, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, 'blob_upload_abandoned', ?, ?, ?)
         ON CONFLICT (object_key) DO NOTHING`
      );
      let count = 0;
      for (const row of rows) {
        const result = await updateUpload.run(expiredAt, row.id);
        if (result.changes !== 1) continue;
        await updateOperation.run(expiredAt, row.operation_id);
        await insertJob.run(
          randomUUID(),
          row.object_key,
          expiredAt,
          expiredAt,
          expiredAt
        );
        count += 1;
      }
      return count;
    });
  }

  async claimDeletionJobs(input: {
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
    readonly limit: number;
  }): Promise<BlobDeletionJobRow[]> {
    return await this._database.transaction(async (database) => {
      const rows = await database.prepare(
        `SELECT id, object_key, attempt_count
         FROM object_deletion_jobs
         WHERE next_attempt_at <= ?
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
         ORDER BY next_attempt_at, id
         LIMIT ?`
      ).all(input.now, input.now, input.limit) as unknown as BlobDeletionJobRow[];
      const claim = database.prepare(
        `UPDATE object_deletion_jobs
         SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ?
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`
      );
      const claimed: BlobDeletionJobRow[] = [];
      for (const row of rows) {
        const result = await claim.run(
          input.workerId,
          input.now + input.leaseMs,
          input.now,
          row.id,
          input.now
        );
        if (result.changes === 1) claimed.push(row);
      }
      return claimed;
    });
  }

  async completeDeletionJob(jobId: string, workerId: string): Promise<void> {
    await this._database.prepare(
      "DELETE FROM object_deletion_jobs WHERE id = ? AND lease_owner = ?"
    ).run(jobId, workerId);
  }

  async failDeletionJob(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly message: string;
    readonly nextAttemptAt: number;
    readonly updatedAt: number;
  }): Promise<void> {
    await this._database.prepare(
      `UPDATE object_deletion_jobs
       SET attempt_count = attempt_count + 1,
           next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
           last_error_code = 'DELETE_FAILED', last_error_message = ?,
           updated_at = ?
       WHERE id = ? AND lease_owner = ?`
    ).run(
      input.nextAttemptAt,
      input.message,
      input.updatedAt,
      input.jobId,
      input.workerId
    );
  }

  private async requireUpload(uploadId: string): Promise<BlobUploadRow> {
    const row = await this._database.prepare(
      "SELECT * FROM blob_upload_sessions WHERE id = ?"
    ).get(uploadId) as BlobUploadRow | undefined;
    if (!row) throw new Error("Blob Upload Session is missing.");
    return row;
  }

  private async requireByOperation(operationId: string): Promise<ReservedBlobUpload> {
    const operation = await this._database.prepare(
      "SELECT * FROM operations WHERE id = ?"
    ).get(operationId) as BlobOperationRow | undefined;
    const upload = await this._database.prepare(
      "SELECT * FROM blob_upload_sessions WHERE operation_id = ?"
    ).get(operationId) as BlobUploadRow | undefined;
    if (!operation || !upload) {
      throw new Error("Reserved Blob Upload is incomplete.");
    }
    return {
      created: false,
      operation: blobOperationView(operation),
      actorUserId: operation.actor_user_id,
      upload,
      payload: JSON.parse(operation.payload_json) as BlobUploadPayload,
    };
  }
}

export async function insertReadyBlobResource(database: PostgresDatabase, input: {
  nodeId: string; resourceId: string; spaceId: string; parentNodeId: string | null;
  name: string; createdBy: string; originalFilename: string; objectKey: string;
  mediaType: string; byteSize: number; sha256: string; etag: string; now: number;
}): Promise<void> {
  await database.prepare(
    `INSERT INTO nodes
      (id, space_id, parent_id, name, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.nodeId,
    input.spaceId,
    input.parentNodeId,
    input.name,
    input.createdBy,
    input.now,
    input.now
  );
  await database.prepare(
    `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
     VALUES (?, ?, 'blob', ?, ?)`
  ).run(input.resourceId, input.nodeId, input.now, input.now);
  await database.prepare(
    `INSERT INTO blob_resources
      (resource_id, object_key, original_filename, media_type, byte_size,
       sha256, etag, availability, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`
  ).run(
    input.resourceId,
    input.objectKey,
    input.originalFilename,
    input.mediaType,
    input.byteSize,
    input.sha256,
    input.etag,
    input.now,
    input.now
  );
}

export async function swapBlobContent(database: PostgresDatabase, input: {
  resourceId: string; expectedEtag: string; objectKey: string;
  stored: Pick<StoredBlob, "mediaType" | "byteSize" | "sha256">; now: number;
}): Promise<{ etag: string } | "etag-mismatch"> {
  const current = await database
    .prepare("SELECT object_key, etag FROM blob_resources WHERE resource_id = ?")
    .get(input.resourceId) as { object_key: string; etag: string } | undefined;
  if (!current || current.etag !== input.expectedEtag) {
    return "etag-mismatch";
  }
  const etag = randomUUID();
  await database
    .prepare(`UPDATE blob_resources SET object_key = ?, media_type = ?, byte_size = ?,
    sha256 = ?, etag = ?, updated_at = ? WHERE resource_id = ? AND etag = ?`)
    .run(
      input.objectKey,
      input.stored.mediaType,
      input.stored.byteSize,
      input.stored.sha256,
      etag,
      input.now,
      input.resourceId,
      input.expectedEtag,
    );
  await database
    .prepare("UPDATE resources SET updated_at = ? WHERE id = ?")
    .run(input.now, input.resourceId);
  await database
    .prepare(
      "UPDATE nodes SET updated_at = ? WHERE id = (SELECT node_id FROM resources WHERE id = ?)",
    )
    .run(input.now, input.resourceId);
  await enqueueObjectDeletion(database, current.object_key, "blob_content_replaced", input.now);
  return { etag };
}

export async function enqueueObjectDeletion(database: PostgresDatabase, objectKey: string,
  reason: "blob_upload_abandoned" | "blob_content_replaced", now: number): Promise<void> {
  await database.prepare(`INSERT INTO object_deletion_jobs (id, object_key, reason, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (object_key) DO NOTHING`).run(randomUUID(), objectKey, reason, now, now, now);
}

function blobOperationView(row: BlobOperationRow): OperationView {
  return {
    id: row.id,
    kind: "createBlobResource",
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    result: row.result_json ? JSON.parse(row.result_json) as Readonly<Record<string, unknown>> : null,
    error: row.last_error_code && row.last_error_message
      ? { code: row.last_error_code, message: row.last_error_message }
      : null,
  };
}
