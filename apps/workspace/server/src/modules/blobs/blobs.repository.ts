import type { BlobReplacementResult } from "./blobs.types.js";
import type { StoredBlob } from "../../integrations/blob/blob-store.js";
import type { OperationView } from "../resources/index.js";

export interface BlobReplacementIntent {
  readonly resourceId: string;
  readonly expectedEtag: string;
  readonly byteSize: number;
}

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

export interface ReservedBlobUpload {
  readonly created: boolean;
  readonly operation: OperationView;
  readonly actorUserId: string;
  readonly upload: BlobUploadRow;
  readonly payload: BlobUploadPayload;
}

export interface BlobDeletionJobRow {
  readonly id: string;
  readonly object_key: string;
  readonly attempt_count: number;
}

export class BlobReplacementConflictError extends Error {
  constructor(readonly reason: "intent" | "state" | "etag") {
    super(`Blob replacement conflict: ${reason}`);
  }
}

export class BlobReservationConflictError extends Error {}

export class BlobUploadStateConflictError extends Error {}

export interface BlobsRepository {
  reserveReplacement(
    operationId: string,
    userId: string,
    intent: BlobReplacementIntent,
    now: number,
  ): Promise<{ readonly objectKey: string; readonly result: BlobReplacementResult | null }>;
  completeReplacement(
    operationId: string,
    intent: BlobReplacementIntent,
    objectKey: string,
    stored: StoredBlob,
    now: number,
  ): Promise<BlobReplacementResult>;
  failReplacement(operationId: string, code: string, message: string, now: number): Promise<void>;
  pendingReplacementIds(): Promise<string[]>;
  reserve(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly intent: BlobUploadIntent;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): Promise<ReservedBlobUpload>;
  find(uploadId: string, actorUserId: string): Promise<ReservedBlobUpload | null>;
  recoverInterruptedUploads(recoveredAt: number): Promise<number>;
  beginUpload(uploadId: string, updatedAt: number): Promise<boolean>;
  markUploaded(input: {
    readonly uploadId: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly etag: string;
    readonly mediaType: string;
    readonly updatedAt: number;
  }): Promise<BlobUploadRow>;
  resetUploadAfterFailure(
    uploadId: string,
    message: string,
    updatedAt: number
  ): Promise<void>;
  complete(uploadId: string, completedAt: number): Promise<ReservedBlobUpload>;
  /** A completed or expired upload cannot be aborted or scheduled for object deletion. */
  abort(uploadId: string, abortedAt: number): Promise<boolean>;
  expireDue(expiredAt: number, limit: number): Promise<number>;
  claimDeletionJobs(input: {
    readonly workerId: string;
    readonly now: number;
    readonly leaseMs: number;
    readonly limit: number;
  }): Promise<BlobDeletionJobRow[]>;
  completeDeletionJob(jobId: string, workerId: string): Promise<void>;
  failDeletionJob(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly message: string;
    readonly nextAttemptAt: number;
    readonly updatedAt: number;
  }): Promise<void>;
}
