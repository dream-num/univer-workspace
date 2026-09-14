/** Blob content protocol; session-local file handling belongs to the tools. */
import type { WorkspaceHttpClient } from "./workspace-contract.ts";
import type { WorkspaceDocument } from "../shared/wire.ts";
import { readJson, stringField, WorkspaceApiError } from "./api-errors.ts";
import { narrowDocument } from "./spaces-api.ts";

export interface UploadBlobInput {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly originalFilename: string;
  readonly bytes: Uint8Array;
  readonly idempotencyKey: string;
}

export interface BlobUploadResult {
  readonly operationId: string;
  readonly uploadId: string;
  readonly nodeId: string;
  readonly resourceId: string;
}

export interface DownloadedBlob {
  readonly bytes: Uint8Array;
  readonly etag: string;
  readonly mediaType: string;
}

export interface ReplaceBlobInput {
  readonly resourceId: string;
  readonly bytes: Uint8Array;
  readonly etag: string;
  readonly idempotencyKey: string;
}

export interface BlobReplacementResult {
  readonly operationId: string;
  readonly resourceId: string;
  readonly etag: string;
}

export async function getBlob(
  client: WorkspaceHttpClient,
  resourceId: string,
): Promise<WorkspaceDocument> {
  const raw = await readJson(
    await client.request(`/api/resources/${encodeURIComponent(resourceId)}`),
    "blob metadata",
  );
  const node = ((raw ?? {}) as { node?: Record<string, unknown> }).node;
  const spaceId = stringField(node?.spaceId);
  const document = spaceId === undefined ? undefined : narrowDocument(node, spaceId);
  if (document?.resourceId !== resourceId) {
    throw new WorkspaceApiError("workspace returned invalid Blob metadata", 502, "MALFORMED_BLOB");
  }
  if (document.resourceKind !== "blob") {
    throw new WorkspaceApiError("Resource is not a Blob", 400, "INVALID_RESOURCE_KIND");
  }
  return document;
}

export async function uploadBlob(
  client: WorkspaceHttpClient,
  input: UploadBlobInput,
): Promise<BlobUploadResult> {
  try {
    // Reserving again with the same key resumes the existing upload, including completed writes.
    const raw = await readJson(
      await client.request("/api/blob-upload-sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({
          spaceId: input.spaceId,
          parentNodeId: input.parentNodeId,
          name: input.name,
          originalFilename: input.originalFilename,
          byteSize: input.bytes.byteLength,
        }),
      }),
      "blob upload reservation",
    );
    const envelope = (raw ?? {}) as Record<string, unknown>;
    const operation = (envelope.operation ?? {}) as Record<string, unknown>;
    const upload = (envelope.upload ?? {}) as Record<string, unknown>;
    const uploadId = stringField(upload.id);
    const nodeId = stringField(upload.nodeId);
    const resourceId = stringField(upload.resourceId);
    if (
      !uploadId ||
      !nodeId ||
      !resourceId ||
      operation.id !== input.idempotencyKey ||
      operation.kind !== "createBlobResource" ||
      upload.operationId !== input.idempotencyKey ||
      upload.byteSize !== input.bytes.byteLength
    ) {
      throw new WorkspaceApiError(
        "workspace returned an invalid Blob upload",
        502,
        "MALFORMED_BLOB",
      );
    }
    const result = { operationId: input.idempotencyKey, uploadId, nodeId, resourceId };
    if (upload.state === "completed" && operation.state === "completed") return result;
    if (
      ["failed", "expired", "aborted"].includes(String(upload.state)) ||
      operation.state === "failed"
    ) {
      throw new WorkspaceApiError(
        `Blob upload ${uploadId} cannot continue (${upload.state}). Use a new idempotencyKey for a new upload.`,
        0,
        "WORKSPACE_UPLOAD_FAILED",
      );
    }
    if (upload.state === "verifying") {
      throw new WorkspaceApiError(
        `Blob upload ${uploadId} is still receiving content. Retry later with the same file and idempotencyKey ${input.idempotencyKey}.`,
        0,
        "WORKSPACE_UPLOAD_PENDING",
      );
    }
    if (
      operation.state !== "pending" ||
      !["waitingForUpload", "uploaded"].includes(String(upload.state))
    ) {
      throw new WorkspaceApiError(
        "workspace returned an invalid Blob upload state",
        502,
        "MALFORMED_BLOB",
      );
    }
    const path = `/api/blob-upload-sessions/${encodeURIComponent(uploadId)}`;
    if (upload.state === "waitingForUpload") {
      const response = await client.request(`${path}/content`, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(input.bytes.byteLength),
        },
        body: new Uint8Array(input.bytes),
      });
      if (!response.ok) await readJson(response, "blob upload content");
    }
    const completed = ((await readJson(
      await client.request(`${path}/complete`, { method: "POST" }),
      "blob upload completion",
    )) ?? {}) as {
      operation?: Record<string, unknown>;
      node?: { id?: unknown; resource?: { id?: unknown } };
    };
    if (
      completed.operation?.id !== input.idempotencyKey ||
      completed.operation.state !== "completed" ||
      completed.node?.id !== nodeId ||
      completed.node.resource?.id !== resourceId
    ) {
      throw new WorkspaceApiError(
        "workspace returned an invalid Blob upload result",
        502,
        "MALFORMED_BLOB",
      );
    }
    return result;
  } catch (error) {
    if (error instanceof WorkspaceApiError) throw error;
    throw new WorkspaceApiError(
      `Blob upload result is unknown. Retry with the same file and idempotencyKey ${input.idempotencyKey} to resume this upload.`,
      0,
      "WORKSPACE_RESULT_UNKNOWN",
    );
  }
}

function strongEtag(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && /^"[^"\r\n]+"$/.test(value);
}

export async function downloadBlob(
  client: WorkspaceHttpClient,
  resourceId: string,
): Promise<DownloadedBlob> {
  const response = await client.request(
    `/api/blob-resources/${encodeURIComponent(resourceId)}/download`,
  );
  if (!response.ok) await readJson(response, "blob download");
  const etag = response.headers.get("etag");
  const mediaType = response.headers.get("content-type");
  if (!strongEtag(etag) || !mediaType) {
    throw new WorkspaceApiError(
      "workspace Blob download is missing content metadata",
      502,
      "MALFORMED_BLOB",
    );
  }
  return { bytes: new Uint8Array(await response.arrayBuffer()), etag, mediaType };
}

export async function replaceBlob(
  client: WorkspaceHttpClient,
  input: ReplaceBlobInput,
): Promise<BlobReplacementResult> {
  if (!strongEtag(input.etag)) {
    throw new WorkspaceApiError(
      "If-Match must be the quoted ETag from the downloaded Blob",
      400,
      "INVALID_ETAG",
    );
  }
  try {
    const raw = await readJson(
      await client.request(`/api/blob-resources/${encodeURIComponent(input.resourceId)}/content`, {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(input.bytes.byteLength),
          "if-match": input.etag,
          "idempotency-key": input.idempotencyKey,
        },
        body: new Uint8Array(input.bytes),
      }),
      "blob replacement",
    );
    return replacementResult(raw, input);
  } catch (error) {
    if (error instanceof WorkspaceApiError) throw error;
    // Confirm the same Operation after a lost response; never start another write here.
    let raw: unknown;
    try {
      raw = await readJson(
        await client.request(`/api/operations/${encodeURIComponent(input.idempotencyKey)}`),
        "blob replacement status",
      );
    } catch {
      throw unknownReplacement(input);
    }
    const operation = (raw ?? {}) as Record<string, unknown>;
    if (operation.id !== input.idempotencyKey || operation.kind !== "replaceBlobContent") {
      throw new WorkspaceApiError(
        "workspace Blob replacement returned a different Operation",
        502,
        "MALFORMED_OPERATION",
      );
    }
    if (operation.state === "completed") return replacementResult(operation.result, input);
    if (operation.state === "failed") {
      const failure = (operation.error ?? {}) as Record<string, unknown>;
      const message =
        typeof failure.message === "string" ? failure.message : "Blob replacement failed";
      const code = typeof failure.code === "string" ? failure.code : "WORKSPACE_REPLACEMENT_FAILED";
      throw new WorkspaceApiError(
        `${message}. Operation ID: ${input.idempotencyKey}. Retry with a new key after reconciling current content.`,
        code === "PRECONDITION_FAILED" ? 412 : 0,
        code,
      );
    }
    if (operation.state === "pending") throw unknownReplacement(input);
    throw new WorkspaceApiError(
      "workspace Blob replacement returned an invalid state",
      502,
      "MALFORMED_OPERATION",
    );
  }
}

function replacementResult(raw: unknown, input: ReplaceBlobInput): BlobReplacementResult {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (
    value.operationId !== input.idempotencyKey ||
    value.resourceId !== input.resourceId ||
    !strongEtag(value.etag)
  ) {
    throw new WorkspaceApiError(
      "workspace Blob replacement returned an invalid result",
      502,
      "MALFORMED_BLOB",
    );
  }
  return { operationId: input.idempotencyKey, resourceId: input.resourceId, etag: value.etag };
}

function unknownReplacement(input: ReplaceBlobInput): WorkspaceApiError {
  return new WorkspaceApiError(
    `Blob replacement result is unknown. Inspect Operation ${input.idempotencyKey} before retrying with the same key.`,
    0,
    "WORKSPACE_RESULT_UNKNOWN",
  );
}
