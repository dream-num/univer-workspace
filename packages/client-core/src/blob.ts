import { randomUUID } from "node:crypto";
import {
  executeWithStableIdentity,
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  workspaceError,
} from "./errors.js";
import {
  contentLength,
  inspectSource,
  openSource,
  prepareDownload,
  responseContent,
  type SourceFile,
} from "./files.js";
import {
  isWorkspaceRecord,
  type AuthenticatedWorkspaceHttp,
  type WorkspaceHttp,
} from "./http.js";
import {
  parseDetachedNode,
  parseNodeResource,
  type WorkspaceBlobResource,
  type WorkspaceNodeSummary,
} from "./space-model.js";

type UploadState =
  | "waitingForUpload"
  | "uploaded"
  | "verifying"
  | "completed"
  | "failed"
  | "expired"
  | "aborted";

interface WorkspaceOperation {
  readonly operationId: string;
  readonly kind: string;
  readonly state: "pending" | "completed" | "failed";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

interface UploadSession {
  readonly uploadId: string;
  readonly operationId: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly state: UploadState;
  readonly name: string;
  readonly originalFilename: string;
  readonly byteSize: number;
  readonly receivedSize: number | null;
  readonly detectedMediaType: string | null;
  readonly sha256: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface UploadEnvelope {
  readonly operation: WorkspaceOperation;
  readonly upload: UploadSession;
  readonly uploadTarget: { readonly method: "PUT"; readonly contentUrl: string } | null;
}

interface UploadIntent {
  readonly idempotencyKey: string;
  readonly spaceId: string;
  readonly parentNodeId?: string;
  readonly name: string;
  readonly originalFilename: string;
  readonly byteSize: number;
  readonly declaredMediaType?: string;
}

const BLOB_UPLOAD_MAX_ATTEMPTS = 3;

export class WorkspaceBlobFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async get(
    resourceId: string,
    signal?: AbortSignal,
  ): Promise<{ readonly node: WorkspaceNodeSummary; readonly resource: WorkspaceBlobResource }> {
    const id = requireIdentity(resourceId, "Resource ID");
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    return await getBlob(http, id, signal);
  }

  public async upload(input: {
    readonly declaredMediaType?: string;
    readonly filePath: string;
    readonly idempotencyKey?: string;
    readonly name?: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
  }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const source = await inspectSource(input.filePath, signal);
    const declaredMediaType = normalizeOptionalMediaType(input.declaredMediaType);
    const intent: UploadIntent = {
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      spaceId: requireIdentity(input.spaceId, "Space ID"),
      ...(input.parentNodeId === undefined
        ? {}
        : { parentNodeId: requireIdentity(input.parentNodeId, "Parent Node ID") }),
      name: normalizeName(input.name ?? source.originalFilename),
      originalFilename: source.originalFilename,
      byteSize: source.byteSize,
      ...(declaredMediaType === undefined ? {} : { declaredMediaType }),
    };
    signal?.throwIfAborted();
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    let envelope: UploadEnvelope;
    let reserveDispatched = false;
    try {
      envelope = await executeWithStableIdentity({
        identity: intent,
        maxAttempts: BLOB_UPLOAD_MAX_ATTEMPTS,
        publicIdentity: publicUploadIntent(intent, source.path),
        operation: async (sameIntent) => {
          reserveDispatched = true;
          return await reserve(http, sameIntent, signal);
        },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (reserveDispatched) throwCancelledUploadUnknown(error, signal, intent, source.path);
      throw error;
    }
    if (signal?.aborted) throw uploadUnknown(intent, source.path, envelope);
    assertUploadIntent(envelope, intent);
    const reserved = envelope;

    for (let attempt = 0; attempt < BLOB_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) throw uploadUnknown(intent, source.path, envelope);
      if (envelope.upload.state === "waitingForUpload") {
        envelope = await this.uploadBytes(http, envelope, reserved, intent, source, signal);
        continue;
      }
      if (envelope.upload.state === "verifying") {
        try {
          envelope = await getEnvelope(http, envelope.upload.uploadId, signal);
        } catch (error) {
          throwCancelledUploadUnknown(error, signal, intent, source.path, envelope);
        }
        assertUploadIdentity(envelope, reserved);
        assertUploadIntent(envelope, intent);
        continue;
      }
      if (envelope.upload.state === "uploaded") {
        const completed = await this.complete(http, envelope, intent, source.path, signal);
        if (completed !== undefined) return completed;
        if (signal?.aborted) throw uploadUnknown(intent, source.path, envelope);
        try {
          envelope = await getEnvelope(http, envelope.upload.uploadId, signal);
        } catch (error) {
          throwCancelledUploadUnknown(error, signal, intent, source.path, envelope);
        }
        assertUploadIdentity(envelope, reserved);
        assertUploadIntent(envelope, intent);
        continue;
      }
      if (envelope.upload.state === "completed") {
        return await this.completedResult(http, envelope, intent, source.path, signal);
      }
      throw terminalUploadError(envelope, intent, source.path);
    }

    throw new WorkspaceApplicationError(
      "workspace-result-unknown",
      "Blob upload did not reach a stable state within the bounded recovery attempts.",
      {
        ...publicUploadIntent(intent, source.path),
        uploadId: envelope.upload.uploadId,
        state: envelope.upload.state,
      },
    );
  }

  public async download(input: {
    readonly force?: boolean;
    readonly outputPath: string;
    readonly resourceId: string;
  }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const view = await this.get(input.resourceId, signal);
    if (view.resource.availability !== "ready" || !view.resource.capabilities.downloadContent) {
      throw workspaceError(
        "workspace-blob-download-unavailable",
        "Workspace Blob is not available for download.",
        {
          resourceId: view.resource.resourceId,
          availability: view.resource.availability,
          downloadContent: view.resource.capabilities.downloadContent,
        },
      );
    }
    const target = await prepareDownload({
      kind: "blob",
      outputPath: input.outputPath,
      ...(input.force === true ? { force: true } : {}),
      ...(signal === undefined ? {} : { signal }),
    });
    let response: Response | undefined;
    try {
      const http = await this.authenticatedHttp(signal);
      signal?.throwIfAborted();
      response = await http.request(
        `/api/blob-resources/${encodeURIComponent(view.resource.resourceId)}/download`,
        signal === undefined ? {} : { signal },
      );
      const mediaType = response.headers.get("content-type");
      if (mediaType === null || mediaType.length === 0 || response.body === null) {
        throw workspaceError(
          "workspace-invalid-response",
          "Workspace Blob download response is missing content metadata.",
        );
      }
      const responseSize = contentLength(response, "Blob");
      if (responseSize !== undefined && responseSize !== view.resource.byteSize) {
        throw workspaceError(
          "workspace-invalid-response",
          "Workspace Blob Content-Length does not match Resource metadata.",
          {
            resourceId: view.resource.resourceId,
            expectedByteSize: view.resource.byteSize,
            actualByteSize: responseSize,
          },
        );
      }
      const written = await target.writeAndCommit(
        responseContent(response, signal),
        view.resource.byteSize,
      );
      const etag = response.headers.get("etag");
      return {
        resourceId: view.resource.resourceId,
        nodeId: view.node.nodeId,
        outputPath: written.outputPath,
        byteSize: written.byteSize,
        mediaType,
        ...(etag === null ? {} : { etag }),
      };
    } finally {
      await response?.body?.cancel().catch(() => undefined);
      await target.discard();
    }
  }

  private async uploadBytes(
    http: WorkspaceHttp,
    envelope: UploadEnvelope,
    reserved: UploadEnvelope,
    intent: UploadIntent,
    source: SourceFile,
    signal?: AbortSignal,
  ): Promise<UploadEnvelope> {
    const uploadId = envelope.upload.uploadId;
    for (let attempt = 0; attempt < BLOB_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) throw uploadUnknown(intent, source.path, envelope);
      try {
        await http.request(`/api/blob-upload-sessions/${encodeURIComponent(uploadId)}/content`, {
          contentLength: source.byteSize,
          contentType: "application/octet-stream",
          method: "PUT",
          streamBody: openSource(source, signal),
          ...(signal === undefined ? {} : { signal }),
        });
        if (signal?.aborted) throw uploadUnknown(intent, source.path, envelope);
        const refreshed = await getEnvelope(http, uploadId, signal);
        assertUploadIdentity(refreshed, reserved);
        assertUploadIntent(refreshed, intent);
        return refreshed;
      } catch (error) {
        if (signal?.aborted) throw uploadUnknown(intent, source.path, envelope);
        if (!isWorkspaceResultUnknown(error)) throw error;
        try {
          const refreshed = await getEnvelope(http, uploadId, signal);
          assertUploadIdentity(refreshed, reserved);
          assertUploadIntent(refreshed, intent);
          if (refreshed.upload.state !== "waitingForUpload") return refreshed;
        } catch (statusError) {
          if (signal?.aborted) throw uploadUnknown(intent, source.path, envelope);
          if (!isWorkspaceResultUnknown(statusError)) throw statusError;
        }
      }
    }
    throw new WorkspaceApplicationError(
      "workspace-result-unknown",
      "Blob byte upload may have completed, but its state could not be confirmed.",
      { ...publicUploadIntent(intent, source.path), uploadId },
    );
  }

  private async complete(
    http: WorkspaceHttp,
    envelope: UploadEnvelope,
    intent: UploadIntent,
    sourcePath: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    if (signal?.aborted) throw uploadUnknown(intent, sourcePath, envelope);
    try {
      const published = parsePublishResult(
        await http.json(
          `/api/blob-upload-sessions/${encodeURIComponent(envelope.upload.uploadId)}/complete`,
          { method: "POST", ...(signal === undefined ? {} : { signal }) },
        ),
      );
      return buildUploadResult(envelope, intent, published.operation, published.node);
    } catch (error) {
      if (signal?.aborted) throw uploadUnknown(intent, sourcePath, envelope);
      if (!isWorkspaceResultUnknown(error)) throw error;
      let refreshed: UploadEnvelope;
      try {
        refreshed = await getEnvelope(http, envelope.upload.uploadId, signal);
      } catch (statusError) {
        if (signal?.aborted) throw uploadUnknown(intent, sourcePath, envelope);
        if (!isWorkspaceResultUnknown(statusError)) throw statusError;
        throw new WorkspaceApplicationError(
          "workspace-result-unknown",
          "Blob completion may have published the Resource, but its state could not be confirmed.",
          { ...publicUploadIntent(intent, sourcePath), uploadId: envelope.upload.uploadId },
        );
      }
      assertUploadIdentity(refreshed, envelope);
      assertUploadIntent(refreshed, intent);
      if (signal?.aborted) throw uploadUnknown(intent, sourcePath, refreshed);
      if (refreshed.upload.state === "completed") {
        return await this.completedResult(http, refreshed, intent, sourcePath, signal);
      }
      return undefined;
    }
  }

  private async completedResult(
    http: WorkspaceHttp,
    envelope: UploadEnvelope,
    intent: UploadIntent,
    sourcePath: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    let view: Awaited<ReturnType<typeof getBlob>>;
    try {
      view = await getBlob(http, envelope.upload.resourceId, signal);
    } catch (error) {
      if (signal?.aborted) throw uploadUnknown(intent, sourcePath, envelope);
      if (!isWorkspaceResultUnknown(error)) throw error;
      const cause =
        error instanceof WorkspaceApplicationError &&
        isWorkspaceRecord(error.detail) &&
        typeof error.detail["cause"] === "string"
          ? error.detail["cause"]
          : undefined;
      throw new WorkspaceApplicationError("workspace-result-unknown", error.message, {
        ...publicUploadIntent(intent, sourcePath),
        uploadId: envelope.upload.uploadId,
        state: envelope.upload.state,
        ...(cause === undefined ? {} : { cause }),
      });
    }
    if (view.resource.kind !== "blob") {
      throw workspaceError(
        "workspace-result-mismatch",
        "Completed Blob Upload Session resolved to a non-Blob Resource.",
        {
          uploadId: envelope.upload.uploadId,
          resourceId: envelope.upload.resourceId,
          actualKind: view.resource.kind,
        },
      );
    }
    return buildUploadResult(envelope, intent, envelope.operation, view.node);
  }
}

async function getBlob(
  http: WorkspaceHttp,
  resourceId: string,
  signal?: AbortSignal,
): Promise<{ readonly node: WorkspaceNodeSummary; readonly resource: WorkspaceBlobResource }> {
  const body = await http.json(
    `/api/resources/${encodeURIComponent(resourceId)}`,
    signal === undefined ? {} : { signal },
  );
  signal?.throwIfAborted();
  const node = parseDetachedNode(body["node"]);
  const resource = parseNodeResource(body["resource"]);
  if (
    resource?.resourceId !== resourceId ||
    JSON.stringify(resource) !== JSON.stringify(node.resource)
  ) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace Resource response does not match the requested Resource and owning Node.",
      { resourceId, nodeId: node.nodeId },
    );
  }
  if (resource.kind !== "blob") {
    throw workspaceError("workspace-resource-kind-mismatch", "Workspace Resource is not a Blob.", {
      resourceId,
      expectedKind: "blob",
      actualKind: resource.kind,
    });
  }
  if (node.resource?.kind !== "blob" || node.resource.resourceId !== resourceId) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace Blob metadata does not match its owning Node.",
      { resourceId, nodeId: node.nodeId },
    );
  }
  return { node, resource };
}

async function reserve(
  http: WorkspaceHttp,
  intent: UploadIntent,
  signal?: AbortSignal,
): Promise<UploadEnvelope> {
  return parseEnvelope(
    await http.json("/api/blob-upload-sessions", {
      body: {
        spaceId: intent.spaceId,
        parentNodeId: intent.parentNodeId ?? null,
        name: intent.name,
        originalFilename: intent.originalFilename,
        byteSize: intent.byteSize,
        ...(intent.declaredMediaType === undefined
          ? {}
          : { declaredMediaType: intent.declaredMediaType }),
      },
      idempotencyKey: intent.idempotencyKey,
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

async function getEnvelope(
  http: WorkspaceHttp,
  uploadId: string,
  signal?: AbortSignal,
): Promise<UploadEnvelope> {
  const envelope = parseEnvelope(
    await http.json(
      `/api/blob-upload-sessions/${encodeURIComponent(uploadId)}`,
      signal === undefined ? {} : { signal },
    ),
  );
  if (envelope.upload.uploadId !== uploadId) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace returned a different Blob Upload Session.",
      { expectedUploadId: uploadId, actualUploadId: envelope.upload.uploadId },
    );
  }
  return envelope;
}

function parsePublishResult(value: unknown): {
  readonly operation: WorkspaceOperation;
  readonly node: WorkspaceNodeSummary;
} {
  if (!isWorkspaceRecord(value))
    throw invalidResponse("Workspace Blob completion response is invalid.");
  const operation = parseOperation(value["operation"], "createBlobResource");
  const node = parseDetachedNode(value["node"]);
  if (node.resource?.kind !== "blob") {
    throw invalidResponse("Workspace Blob completion response is missing the published Blob.");
  }
  return { operation, node };
}

function parseEnvelope(value: unknown): UploadEnvelope {
  if (!isWorkspaceRecord(value)) {
    throw invalidResponse("Workspace response contains an invalid Blob Upload Session envelope.");
  }
  const operation = parseOperation(value["operation"], "createBlobResource");
  const upload = parseUploadSession(value["upload"]);
  if (upload.operationId !== operation.operationId) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace Blob Upload Session belongs to a different Operation.",
      {
        uploadId: upload.uploadId,
        uploadOperationId: upload.operationId,
        operationId: operation.operationId,
      },
    );
  }
  return {
    operation,
    upload,
    uploadTarget: parseUploadTarget(value["uploadTarget"], upload.state),
  };
}

function parseOperation(value: unknown, expectedKind?: string): WorkspaceOperation {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    value["id"].length === 0 ||
    typeof value["kind"] !== "string" ||
    !isOperationState(value["state"]) ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string" ||
    (value["result"] !== null && !isWorkspaceRecord(value["result"])) ||
    !isOperationError(value["error"])
  ) {
    throw invalidResponse("Workspace response contains an invalid Operation.");
  }
  if (expectedKind !== undefined && value["kind"] !== expectedKind) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace response returned a different Operation kind.",
      { expectedKind, actualKind: value["kind"], operationId: value["id"] },
    );
  }
  return {
    operationId: value["id"],
    kind: value["kind"],
    state: value["state"],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
    result: value["result"],
    error: value["error"],
  };
}

function parseUploadSession(value: unknown): UploadSession {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    value["id"].length === 0 ||
    typeof value["operationId"] !== "string" ||
    value["operationId"].length === 0 ||
    typeof value["nodeId"] !== "string" ||
    value["nodeId"].length === 0 ||
    typeof value["resourceId"] !== "string" ||
    value["resourceId"].length === 0 ||
    !isUploadState(value["state"]) ||
    typeof value["name"] !== "string" ||
    typeof value["originalFilename"] !== "string" ||
    !isNonNegativeSafeInteger(value["byteSize"]) ||
    (value["receivedSize"] !== null && !isNonNegativeSafeInteger(value["receivedSize"])) ||
    (value["detectedMediaType"] !== null && typeof value["detectedMediaType"] !== "string") ||
    (value["sha256"] !== null && typeof value["sha256"] !== "string") ||
    typeof value["expiresAt"] !== "string" ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string"
  ) {
    throw invalidResponse("Workspace response contains an invalid Blob Upload Session.");
  }
  return {
    uploadId: value["id"],
    operationId: value["operationId"],
    nodeId: value["nodeId"],
    resourceId: value["resourceId"],
    state: value["state"],
    name: value["name"],
    originalFilename: value["originalFilename"],
    byteSize: value["byteSize"],
    receivedSize: value["receivedSize"],
    detectedMediaType: value["detectedMediaType"],
    sha256: value["sha256"],
    expiresAt: value["expiresAt"],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function parseUploadTarget(value: unknown, state: UploadState): UploadEnvelope["uploadTarget"] {
  if (value === null) {
    if (state === "waitingForUpload") {
      throw invalidResponse("Workspace Blob Upload Session is missing its upload target.");
    }
    return null;
  }
  if (
    !isWorkspaceRecord(value) ||
    value["method"] !== "PUT" ||
    typeof value["contentUrl"] !== "string" ||
    value["contentUrl"].length === 0
  ) {
    throw invalidResponse("Workspace response contains an invalid Blob upload target.");
  }
  return { method: "PUT", contentUrl: value["contentUrl"] };
}

function buildUploadResult(
  envelope: UploadEnvelope,
  intent: UploadIntent,
  operation: WorkspaceOperation,
  node: WorkspaceNodeSummary,
): Record<string, unknown> {
  const resource = node.resource;
  if (
    resource?.kind !== "blob" ||
    operation.operationId !== envelope.operation.operationId ||
    node.nodeId !== envelope.upload.nodeId ||
    resource.resourceId !== envelope.upload.resourceId ||
    node.spaceId !== intent.spaceId ||
    node.parentNodeId !== (intent.parentNodeId ?? null) ||
    node.name !== intent.name ||
    resource.byteSize !== intent.byteSize
  ) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Published Blob does not match the reserved upload intent.",
      {
        uploadId: envelope.upload.uploadId,
        expectedNodeId: envelope.upload.nodeId,
        expectedResourceId: envelope.upload.resourceId,
        actualNodeId: node.nodeId,
        actualResourceId: resource?.resourceId,
      },
    );
  }
  return {
    idempotencyKey: intent.idempotencyKey,
    uploadId: envelope.upload.uploadId,
    operationId: operation.operationId,
    nodeId: node.nodeId,
    resourceId: resource.resourceId,
    name: node.name,
    originalFilename: intent.originalFilename,
    byteSize: resource.byteSize,
    mediaType: resource.mediaType,
    availability: resource.availability,
    node,
    resource,
  };
}

function assertUploadIdentity(envelope: UploadEnvelope, reserved: UploadEnvelope): void {
  if (
    envelope.operation.operationId !== reserved.operation.operationId ||
    envelope.upload.uploadId !== reserved.upload.uploadId ||
    envelope.upload.operationId !== reserved.upload.operationId ||
    envelope.upload.nodeId !== reserved.upload.nodeId ||
    envelope.upload.resourceId !== reserved.upload.resourceId
  ) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Blob Upload Session identity changed during recovery.",
      {
        expected: {
          operationId: reserved.operation.operationId,
          uploadId: reserved.upload.uploadId,
          nodeId: reserved.upload.nodeId,
          resourceId: reserved.upload.resourceId,
        },
        actual: {
          operationId: envelope.operation.operationId,
          uploadId: envelope.upload.uploadId,
          nodeId: envelope.upload.nodeId,
          resourceId: envelope.upload.resourceId,
        },
      },
    );
  }
}

function assertUploadIntent(envelope: UploadEnvelope, intent: UploadIntent): void {
  const upload = envelope.upload;
  if (
    upload.name !== intent.name ||
    upload.originalFilename !== intent.originalFilename ||
    upload.byteSize !== intent.byteSize
  ) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Blob Upload Session does not match the requested upload intent.",
      {
        uploadId: upload.uploadId,
        expected: {
          name: intent.name,
          originalFilename: intent.originalFilename,
          byteSize: intent.byteSize,
        },
        actual: {
          name: upload.name,
          originalFilename: upload.originalFilename,
          byteSize: upload.byteSize,
        },
      },
    );
  }
}

function publicUploadIntent(
  intent: UploadIntent,
  sourcePath: string,
): Readonly<Record<string, unknown>> {
  return {
    idempotencyKey: intent.idempotencyKey,
    sourcePath,
    spaceId: intent.spaceId,
    parentNodeId: intent.parentNodeId ?? null,
    name: intent.name,
    originalFilename: intent.originalFilename,
    byteSize: intent.byteSize,
    declaredMediaType: intent.declaredMediaType ?? null,
  };
}

function throwCancelledUploadUnknown(
  error: unknown,
  signal: AbortSignal | undefined,
  intent: UploadIntent,
  sourcePath: string,
  envelope?: UploadEnvelope,
): never {
  if (signal?.aborted) throw uploadUnknown(intent, sourcePath, envelope);
  throw error;
}

function uploadUnknown(
  intent: UploadIntent,
  sourcePath: string,
  envelope?: UploadEnvelope,
): WorkspaceApplicationError {
  return new WorkspaceApplicationError(
    "workspace-result-unknown",
    "Blob upload may have changed Workspace state, but cancellation prevented confirmation.",
    {
      ...publicUploadIntent(intent, sourcePath),
      ...(envelope === undefined
        ? {}
        : { uploadId: envelope.upload.uploadId, state: envelope.upload.state }),
    },
  );
}

function terminalUploadError(
  envelope: UploadEnvelope,
  intent: UploadIntent,
  sourcePath: string,
): WorkspaceApplicationError {
  return new WorkspaceApplicationError(
    "workspace-blob-upload-terminal",
    `Blob Upload Session is ${envelope.upload.state}.`,
    {
      ...publicUploadIntent(intent, sourcePath),
      uploadId: envelope.upload.uploadId,
      state: envelope.upload.state,
      operationError: envelope.operation.error,
    },
  );
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 255) {
    throw workspaceError(
      "workspace-argument-invalid",
      "Blob name must contain between 1 and 255 characters after trimming.",
    );
  }
  return name;
}

function normalizeOptionalMediaType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255) {
    throw workspaceError(
      "workspace-argument-invalid",
      "Blob media type must contain between 1 and 255 characters after trimming.",
    );
  }
  return normalized;
}

function requireIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw workspaceError("workspace-argument-invalid", `${label} must not be empty.`);
  }
  return normalized;
}

function isOperationState(value: unknown): value is WorkspaceOperation["state"] {
  return value === "pending" || value === "completed" || value === "failed";
}

function isOperationError(value: unknown): value is WorkspaceOperation["error"] {
  return (
    value === null ||
    (isWorkspaceRecord(value) &&
      typeof value["code"] === "string" &&
      typeof value["message"] === "string")
  );
}

function isUploadState(value: unknown): value is UploadState {
  return (
    value === "waitingForUpload" ||
    value === "uploaded" ||
    value === "verifying" ||
    value === "completed" ||
    value === "failed" ||
    value === "expired" ||
    value === "aborted"
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalidResponse(message: string): WorkspaceApplicationError {
  return workspaceError("workspace-invalid-response", message);
}
