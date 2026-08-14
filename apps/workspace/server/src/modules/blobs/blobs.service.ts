import type { Readable } from "node:stream";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import { parseByteRange } from "../../integrations/blob/blob-http.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver, BlobResourceAccess } from "../access/index.js";
import { nodeSummary } from "../nodes/nodes.service.js";
import type { ResourceCreateResponse } from "../resources/index.js";
import {
  BlobsRepository,
  BlobReservationConflictError,
  BlobUploadStateConflictError,
  blobOperationView,
  type BlobUploadIntent,
  type BlobUploadRow,
  type ReservedBlobUpload,
} from "./blobs.repository.js";
import type {
  BlobUploadSessionEnvelope,
  BlobUploadSessionView,
  CompleteBlobUploadResult,
} from "./blobs.types.js";

export interface BlobsModule {
  createUpload(
    userId: string,
    idempotencyKey: unknown,
    input: unknown
  ): { readonly status: 200 | 201; readonly body: BlobUploadSessionEnvelope };
  getUpload(userId: string, uploadId: string): BlobUploadSessionEnvelope;
  upload(
    userId: string,
    uploadId: string,
    contentLength: unknown,
    body: Readable
  ): Promise<void>;
  complete(userId: string, uploadId: string): Promise<CompleteBlobUploadResult>;
  abort(userId: string, uploadId: string): void;
  openContent(
    userId: string,
    resourceId: string,
    range: string | undefined
  ): Promise<{
    readonly access: BlobResourceAccess;
    readonly stream: Readable;
    readonly totalByteSize: number;
    readonly start: number;
    readonly end: number;
    readonly partial: boolean;
  }>;
  runMaintenance(workerId: string, limit?: number): Promise<number>;
}

export function createBlobsModule(options: {
  readonly repository: BlobsRepository;
  readonly access: AccessResolver;
  readonly store: BlobStore;
  readonly maxBlobBytes?: number;
  readonly now?: () => number;
}): BlobsModule {
  const now = options.now ?? Date.now;
  const maxBlobBytes = options.maxBlobBytes ?? 512 * 1024 * 1024;
  options.repository.recoverInterruptedUploads(now());

  function reservation(userId: string, uploadId: string): ReservedBlobUpload {
    const value = options.repository.find(uploadId, userId);
    if (!value) throw notFound();
    return value;
  }

  function envelope(value: ReservedBlobUpload): BlobUploadSessionEnvelope {
    return {
      operation: blobOperationView(value.operation),
      upload: uploadView(value.upload),
      uploadTarget:
        value.upload.state === "waiting_for_upload"
          ? {
              method: "PUT",
              contentUrl: `/api/blob-upload-sessions/${encodeURIComponent(value.upload.id)}/content`,
            }
          : null,
    };
  }

  function completed(value: ReservedBlobUpload, status: 200 | 201): {
    readonly status: 200 | 201;
    readonly body: ResourceCreateResponse;
  } {
    const access = options.access.resolveResource(
      value.operation.actor_user_id,
      value.upload.resource_id
    );
    if (!access) throw notFound();
    return {
      status,
      body: {
        operation: blobOperationView(value.operation),
        node: nodeSummary(access.node),
      },
    };
  }

  return {
    createUpload(userId, keyValue, inputValue) {
      const operationId = validOperationId(keyValue);
      const intent = validIntent(inputValue, maxBlobBytes);
      validateTarget(userId, intent, options.access);
      let reserved;
      try {
        reserved = options.repository.reserve({
          operationId,
          actorUserId: userId,
          intent,
          createdAt: now(),
          expiresAt: now() + 24 * 60 * 60 * 1000,
        });
      } catch (error) {
        if (error instanceof BlobReservationConflictError) {
          throw conflict(error.message);
        }
        throw error;
      }
      assertSameIntent(userId, intent, reserved);
      return { status: reserved.created ? 201 : 200, body: envelope(reserved) };
    },

    getUpload(userId, uploadId) {
      return envelope(reservation(userId, uploadId));
    },

    async upload(userId, uploadId, contentLengthValue, body) {
      const value = reservation(userId, uploadId);
      if (value.upload.state === "uploaded") {
        body.resume();
        return;
      }
      if (value.upload.state !== "waiting_for_upload") {
        throw conflict("Blob Upload Session does not accept content.");
      }
      const contentLength = Number(contentLengthValue);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        throw invalidInput("Content-Length is required.", "Content-Length");
      }
      if (contentLength !== value.upload.byte_size) {
        throw conflict("Content-Length does not match the reserved byte size.");
      }
      if (!options.repository.beginUpload(uploadId, now())) {
        throw conflict("Blob Upload Session is already receiving content.");
      }
      let stored;
      try {
        stored = await options.store.put({
          objectKey: value.upload.object_key,
          body,
          expectedByteSize: value.upload.byte_size,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Blob upload failed.";
        options.repository.resetUploadAfterFailure(uploadId, message, now());
        throw conflict(message);
      }
      try {
        options.repository.markUploaded({
          uploadId,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          etag: stored.etag,
          mediaType: stored.mediaType,
          updatedAt: now(),
        });
      } catch (error) {
        if (error instanceof BlobUploadStateConflictError) {
          throw conflict(error.message);
        }
        throw error;
      }
    },

    async complete(userId, uploadId) {
      const value = reservation(userId, uploadId);
      if (value.upload.state === "completed") return completed(value, 200);
      if (value.upload.state !== "uploaded") {
        throw conflict("Blob bytes must be uploaded before completion.");
      }
      validateTarget(userId, value.payload, options.access);
      const object = await options.store.head(value.upload.object_key);
      if (!object || object.byteSize !== value.upload.byte_size) {
        throw conflict("Stored Blob does not match the Upload Session.");
      }
      const result = options.repository.complete(uploadId, now());
      return completed(result, 201);
    },

    abort(userId, uploadId) {
      const value = reservation(userId, uploadId);
      if (value.upload.state === "completed") {
        throw conflict("A completed Blob Upload cannot be aborted.");
      }
      if (value.upload.state === "aborted") return;
      if (
        value.upload.state !== "waiting_for_upload" &&
        value.upload.state !== "uploaded" &&
        value.upload.state !== "verifying"
      ) {
        throw conflict("Blob Upload Session can no longer be aborted.");
      }
      options.repository.abort(uploadId, now());
    },

    async openContent(userId, resourceId, rangeHeader) {
      const access = requireBlobAccess(options.access, userId, resourceId);
      if (!access.capabilities.openContent || access.availability !== "ready") {
        throw notFound();
      }
      const range = parseByteRange(rangeHeader, access.byteSize);
      const opened = await options.store.open({
        objectKey: access.objectKey,
        ...(range ? { start: range.start, end: range.end } : {}),
      });
      return { access, ...opened, partial: range !== null };
    },

    async runMaintenance(workerId, limit = 25) {
      const startedAt = now();
      options.repository.expireDue(startedAt, limit);
      const jobs = options.repository.claimDeletionJobs({
        workerId,
        now: startedAt,
        leaseMs: 30_000,
        limit,
      });
      for (const job of jobs) {
        try {
          await options.store.delete(job.object_key);
          options.repository.completeDeletionJob(job.id, workerId);
        } catch (error) {
          const failedAt = now();
          const delay = Math.min(
            60 * 60 * 1000,
            1_000 * 2 ** Math.min(job.attempt_count, 12)
          );
          options.repository.failDeletionJob({
            jobId: job.id,
            workerId,
            message:
              error instanceof Error
                ? error.message
                : "Blob deletion failed.",
            nextAttemptAt: failedAt + delay,
            updatedAt: failedAt,
          });
        }
      }
      return jobs.length;
    },
  };
}

function uploadView(row: BlobUploadRow): BlobUploadSessionView {
  const states = {
    waiting_for_upload: "waitingForUpload",
    uploaded: "uploaded",
    verifying: "verifying",
    completed: "completed",
    failed: "failed",
    expired: "expired",
    aborted: "aborted",
  } as const;
  return {
    id: row.id,
    operationId: row.operation_id,
    nodeId: row.node_id,
    resourceId: row.resource_id,
    state: states[row.state],
    name: row.node_name,
    originalFilename: row.original_filename,
    byteSize: row.byte_size,
    receivedSize: row.received_size,
    detectedMediaType: row.detected_media_type,
    sha256: row.sha256,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function validIntent(value: unknown, maxBytes: number): BlobUploadIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInput("A Blob Upload definition is required.");
  }
  const record = value as Record<string, unknown>;
  const byteSize = Number(record.byteSize);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw invalidInput("byteSize must be a non-negative integer.", "byteSize");
  }
  if (byteSize > maxBytes) {
    throw new ApplicationError(
      "PAYLOAD_TOO_LARGE",
      413,
      `Blob exceeds the ${maxBytes} byte limit.`,
      "byteSize"
    );
  }
  return {
    spaceId: requiredString(record.spaceId, "spaceId", 255),
    parentNodeId:
      record.parentNodeId === null
        ? null
        : requiredString(record.parentNodeId, "parentNodeId", 255),
    name: requiredString(record.name, "name", 255).trim(),
    originalFilename: requiredString(
      record.originalFilename,
      "originalFilename",
      1024
    ),
    byteSize,
    declaredMediaType:
      record.declaredMediaType === undefined
        ? null
        : requiredString(record.declaredMediaType, "declaredMediaType", 255),
  };
}

function validateTarget(
  userId: string,
  input: Pick<BlobUploadIntent, "spaceId" | "parentNodeId">,
  access: AccessResolver
): void {
  if (input.parentNodeId === null) {
    const space = access.resolveSpace(userId, input.spaceId);
    if (!space) throw notFound();
    if (!space.capabilities.createAtRoot) throw forbidden();
    return;
  }
  const parent = access.resolveNode(userId, input.parentNodeId);
  if (!parent || parent.spaceId !== input.spaceId) throw notFound();
  if (!parent.capabilities.createChildren) throw forbidden();
}

function assertSameIntent(
  userId: string,
  intent: BlobUploadIntent,
  value: ReservedBlobUpload
): void {
  const payload = value.payload;
  if (
    value.operation.kind !== "create_blob_resource" ||
    value.operation.actor_user_id !== userId ||
    payload.spaceId !== intent.spaceId ||
    payload.parentNodeId !== intent.parentNodeId ||
    payload.name !== intent.name ||
    payload.originalFilename !== intent.originalFilename ||
    payload.byteSize !== intent.byteSize ||
    payload.declaredMediaType !== intent.declaredMediaType
  ) throw conflict("Idempotency-Key is already associated with another request.");
}

function requireBlobAccess(
  resolver: AccessResolver,
  userId: string,
  resourceId: string
): BlobResourceAccess {
  const value = resolver.resolveResource(userId, resourceId);
  if (!value || value.kind !== "blob") throw notFound();
  return value;
}

function validOperationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) throw invalidInput("Idempotency-Key is invalid.", "Idempotency-Key");
  return value;
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw invalidInput(`${field} is invalid.`, field);
  }
  return value;
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}
function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}
function forbidden(): ApplicationError {
  return new ApplicationError("FORBIDDEN", 403, "This action is not allowed.");
}
function conflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}
