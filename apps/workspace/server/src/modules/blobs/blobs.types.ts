import type { OperationView, ResourceCreateResponse } from "../resources/index.js";

export type BlobUploadState =
  | "waitingForUpload"
  | "uploaded"
  | "verifying"
  | "completed"
  | "failed"
  | "expired"
  | "aborted";

export interface BlobUploadSessionView {
  readonly id: string;
  readonly operationId: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly state: BlobUploadState;
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

export interface BlobUploadSessionEnvelope {
  readonly operation: OperationView;
  readonly upload: BlobUploadSessionView;
  readonly uploadTarget: {
    readonly method: "PUT";
    readonly contentUrl: string;
  } | null;
}

export type CompleteBlobUploadResult = {
  readonly status: 200 | 201;
  readonly body: ResourceCreateResponse;
};
