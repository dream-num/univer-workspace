/** Blob content protocol; session-local file handling belongs to the tools. */
import type { WorkspaceHttpClient } from "./workspace-contract.ts";
import { readJson, WorkspaceApiError } from "./api-errors.ts";

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
