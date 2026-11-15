import { resolve } from "node:path";
import type { WorkspaceConfig } from "../../config.js";
import { LocalBlobStore, type BlobStore } from "./blob-store.js";
import { S3BlobStore } from "./s3-blob-store.js";

export function createBlobStore(config: Pick<WorkspaceConfig, "blobDirectory" | "s3BlobStore">): BlobStore {
  if (config.s3BlobStore) return new S3BlobStore(config.s3BlobStore);
  return new LocalBlobStore(config.blobDirectory ?? resolve(".data/univer-workspace-blobs"));
}
