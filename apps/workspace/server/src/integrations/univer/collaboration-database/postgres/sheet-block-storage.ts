import { S3Client } from "@aws-sdk/client-s3";
import type { S3BlobStoreOptions } from "../../../blob/s3-blob-store.js";

export const SHEET_BLOCK_DIRECTORY = "sheet-blocks";

export function sheetBlockStorage({ bucket, prefix, ...options }: S3BlobStoreOptions) {
  return {
    bucket,
    prefix: prefix ? `${prefix}/${SHEET_BLOCK_DIRECTORY}` : SHEET_BLOCK_DIRECTORY,
    client: new S3Client(options),
  };
}
