import { randomUUID } from "node:crypto";
import type { WorkspaceDatabase } from "../../db/database.js";
import type { OperationView } from "../resources/index.js";

export interface BlobUploadIntent {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly originalFilename: string;
  readonly byteSize: number;
  readonly declaredMediaType: string | null;
}

export interface BlobUploadPayload extends BlobUploadIntent {
  readonly uploadSessionId: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly objectKey: string;
}

export interface BlobUploadRow {
  readonly id: string;
  readonly operation_id: string;
  readonly actor_user_id: string;
  readonly target_space_id: string;
  readonly target_parent_node_id: string | null;
  readonly node_id: string;
  readonly resource_id: string;
  readonly object_key: string;
  readonly node_name: string;
  readonly original_filename: string;
  readonly declared_media_type: string | null;
  readonly detected_media_type: string | null;
  readonly byte_size: number;
  readonly received_size: number | null;
  readonly sha256: string | null;
  readonly etag: string | null;
  readonly state:
    | "waiting_for_upload"
    | "uploaded"
    | "verifying"
    | "completed"
    | "failed"
    | "expired"
    | "aborted";
  readonly expires_at: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly completed_at: number | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
}

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

export interface ReservedBlobUpload {
  readonly created: boolean;
  readonly operation: BlobOperationRow;
  readonly upload: BlobUploadRow;
  readonly payload: BlobUploadPayload;
}

export interface BlobDeletionJobRow {
  readonly id: string;
  readonly object_key: string;
  readonly attempt_count: number;
}

export class BlobReservationConflictError extends Error {}
export class BlobUploadStateConflictError extends Error {}

export class BlobsRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  reserve(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly intent: BlobUploadIntent;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): ReservedBlobUpload {
    return this._database.transaction((database) => {
      const existing = database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(input.operationId) as BlobOperationRow | undefined;
      if (existing) {
        if (existing.kind !== "create_blob_resource") {
          throw new BlobReservationConflictError(
            "Idempotency-Key is already associated with another request."
          );
        }
        const upload = database
          .prepare("SELECT * FROM blob_upload_sessions WHERE operation_id = ?")
          .get(input.operationId) as BlobUploadRow | undefined;
        if (!upload) {
          throw new BlobReservationConflictError(
            "Idempotency-Key is already associated with another request."
          );
        }
        return {
          created: false,
          operation: existing,
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
      database.prepare(
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
      database.prepare(
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
      return { ...this.requireByOperation(input.operationId), created: true };
    });
  }

  find(uploadId: string, actorUserId: string): ReservedBlobUpload | null {
    const upload = this._database.connection.prepare(
      "SELECT * FROM blob_upload_sessions WHERE id = ? AND actor_user_id = ?"
    ).get(uploadId, actorUserId) as BlobUploadRow | undefined;
    if (!upload) return null;
    return this.requireByOperation(upload.operation_id);
  }

  recoverInterruptedUploads(recoveredAt: number): number {
    return Number(this._database.connection.prepare(
      `UPDATE blob_upload_sessions
       SET state = 'waiting_for_upload', updated_at = ?,
           last_error_code = 'UPLOAD_INTERRUPTED',
           last_error_message = 'The server restarted while receiving content.'
       WHERE state = 'verifying'`
    ).run(recoveredAt).changes);
  }

  beginUpload(uploadId: string, updatedAt: number): boolean {
    const result = this._database.connection.prepare(
      `UPDATE blob_upload_sessions
       SET state = 'verifying', updated_at = ?, last_error_code = NULL,
           last_error_message = NULL
       WHERE id = ? AND state = 'waiting_for_upload'`
    ).run(updatedAt, uploadId);
    return result.changes === 1;
  }

  markUploaded(input: {
    readonly uploadId: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly etag: string;
    readonly mediaType: string;
    readonly updatedAt: number;
  }): BlobUploadRow {
    const result = this._database.connection.prepare(
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
    return this.requireUpload(input.uploadId);
  }

  resetUploadAfterFailure(
    uploadId: string,
    message: string,
    updatedAt: number
  ): void {
    this._database.connection.prepare(
      `UPDATE blob_upload_sessions
       SET state = 'waiting_for_upload', updated_at = ?,
           last_error_code = 'UPLOAD_FAILED', last_error_message = ?
       WHERE id = ? AND state = 'verifying'`
    ).run(updatedAt, message, uploadId);
  }

  complete(uploadId: string, completedAt: number): ReservedBlobUpload {
    return this._database.transaction((database) => {
      const upload = this.requireUpload(uploadId);
      if (upload.state === "completed") {
        return this.requireByOperation(upload.operation_id);
      }
      if (
        upload.state !== "uploaded" ||
        upload.received_size !== upload.byte_size ||
        !upload.sha256 ||
        !upload.etag ||
        !upload.detected_media_type
      ) throw new Error("Blob Upload Session is not ready to complete.");
      database.prepare(
        `UPDATE blob_upload_sessions
         SET state = 'verifying', updated_at = ? WHERE id = ?`
      ).run(completedAt, uploadId);
      database.prepare(
        `INSERT INTO nodes
          (id, space_id, parent_id, name, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        upload.node_id,
        upload.target_space_id,
        upload.target_parent_node_id,
        upload.node_name,
        upload.actor_user_id,
        completedAt,
        completedAt
      );
      database.prepare(
        `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
         VALUES (?, ?, 'blob', ?, ?)`
      ).run(upload.resource_id, upload.node_id, completedAt, completedAt);
      database.prepare(
        `INSERT INTO blob_resources
          (resource_id, object_key, original_filename, media_type, byte_size,
           sha256, etag, availability, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`
      ).run(
        upload.resource_id,
        upload.object_key,
        upload.original_filename,
        upload.detected_media_type,
        upload.byte_size,
        upload.sha256,
        upload.etag,
        completedAt,
        completedAt
      );
      const result = JSON.stringify({
        nodeId: upload.node_id,
        resourceId: upload.resource_id,
      });
      database.prepare(
        `UPDATE blob_upload_sessions
         SET state = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(completedAt, completedAt, uploadId);
      database.prepare(
        `UPDATE operations
         SET step = 'completed', state = 'completed', result_json = ?,
             updated_at = ?, completed_at = ?
         WHERE id = ?`
      ).run(result, completedAt, completedAt, upload.operation_id);
      return this.requireByOperation(upload.operation_id);
    });
  }

  abort(uploadId: string, abortedAt: number): void {
    this._database.transaction((database) => {
      const upload = this.requireUpload(uploadId);
      database.prepare(
        `UPDATE blob_upload_sessions
         SET state = 'aborted', updated_at = ?
         WHERE id = ?
           AND state IN ('waiting_for_upload', 'uploaded', 'verifying')`
      ).run(abortedAt, uploadId);
      database.prepare(
        `UPDATE operations
         SET state = 'failed', last_error_code = 'UPLOAD_ABORTED',
             last_error_message = 'Blob upload was aborted.', updated_at = ?
         WHERE id = ? AND state = 'pending'`
      ).run(abortedAt, upload.operation_id);
      database.prepare(
        `INSERT INTO object_deletion_jobs
          (id, object_key, reason, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, 'blob_upload_abandoned', ?, ?, ?)
         ON CONFLICT (object_key) DO NOTHING`
      ).run(randomUUID(), upload.object_key, abortedAt, abortedAt, abortedAt);
    });
  }

  expireDue(expiredAt: number, limit: number): number {
    return this._database.transaction((database) => {
      const rows = database.prepare(
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
        const result = updateUpload.run(expiredAt, row.id);
        if (result.changes !== 1) continue;
        updateOperation.run(expiredAt, row.operation_id);
        insertJob.run(
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

  claimDeletionJobs(input: {
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
    readonly limit: number;
  }): BlobDeletionJobRow[] {
    return this._database.transaction((database) => {
      const rows = database.prepare(
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
      return rows.filter((row) =>
        claim.run(
          input.workerId,
          input.now + input.leaseMs,
          input.now,
          row.id,
          input.now
        ).changes === 1
      );
    });
  }

  completeDeletionJob(jobId: string, workerId: string): void {
    this._database.connection.prepare(
      "DELETE FROM object_deletion_jobs WHERE id = ? AND lease_owner = ?"
    ).run(jobId, workerId);
  }

  failDeletionJob(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly message: string;
    readonly nextAttemptAt: number;
    readonly updatedAt: number;
  }): void {
    this._database.connection.prepare(
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

  private requireUpload(uploadId: string): BlobUploadRow {
    const row = this._database.connection.prepare(
      "SELECT * FROM blob_upload_sessions WHERE id = ?"
    ).get(uploadId) as BlobUploadRow | undefined;
    if (!row) throw new Error("Blob Upload Session is missing.");
    return row;
  }

  private requireByOperation(operationId: string): ReservedBlobUpload {
    const operation = this._database.connection.prepare(
      "SELECT * FROM operations WHERE id = ?"
    ).get(operationId) as BlobOperationRow | undefined;
    const upload = this._database.connection.prepare(
      "SELECT * FROM blob_upload_sessions WHERE operation_id = ?"
    ).get(operationId) as BlobUploadRow | undefined;
    if (!operation || !upload) {
      throw new Error("Reserved Blob Upload is incomplete.");
    }
    return {
      created: false,
      operation,
      upload,
      payload: JSON.parse(operation.payload_json) as BlobUploadPayload,
    };
  }
}

export function blobOperationView(row: BlobOperationRow): OperationView {
  return {
    id: row.id,
    kind: "createBlobResource" as OperationView["kind"],
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.last_error_code && row.last_error_message
      ? { code: row.last_error_code, message: row.last_error_message }
      : null,
  };
}
