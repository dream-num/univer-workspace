import { GetBucketVersioningCommand, type S3Client } from "@aws-sdk/client-s3";
import type { S3BlobStoreOptions } from "../integrations/blob/s3-blob-store.js";

export async function prepareMigrationWrites(
  client: S3Client,
  { bucket, endpoint }: S3BlobStoreOptions,
): Promise<void> {
  if (!endpoint || !/^oss[-.][a-z0-9.-]+\.aliyuncs\.com$/i.test(new URL(endpoint).hostname)) return;

  // OSS ignores its no-overwrite header on both enabled and suspended versioned buckets.
  const { Status } = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
  if (Status !== undefined) {
    throw new Error(`Cannot guarantee create-only migration writes to an OSS bucket with versioning ${Status}`);
  }

  client.middlewareStack.add((next, context) => async (args) => {
    if (context.commandName === "PutObjectCommand" || context.commandName === "CompleteMultipartUploadCommand") {
      const request = args.request as { headers: Record<string, string> };
      if (request.headers["if-none-match"] === "*") {
        delete request.headers["if-none-match"];
        request.headers["x-oss-forbid-overwrite"] = "true";
      }
    }
    return next(args);
  }, { step: "build", name: "ossMigrationConditionalWrite" });
}
