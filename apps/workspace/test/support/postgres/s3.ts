import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, paginateListObjectsV2, S3Client,
} from "@aws-sdk/client-s3";

export async function createTestBucket(resources: AsyncDisposableStack) {
  const endpoint = process.env.WORKSPACE_TEST_S3_ENDPOINT;
  if (!endpoint) throw new Error("Set WORKSPACE_TEST_S3_ENDPOINT to a disposable S3 service");
  const options = { endpoint, region: "us-east-1", forcePathStyle: true, bucket: `uvw-${randomUUID()}`, prefix: "workspace" };
  const client = new S3Client(options);
  resources.defer(() => client.destroy());
  await client.send(new CreateBucketCommand({ Bucket: options.bucket }));
  resources.defer(async () => {
    for await (const page of paginateListObjectsV2({ client }, { Bucket: options.bucket })) {
      for (const { Key } of page.Contents ?? []) {
        await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key }));
      }
    }
    await client.send(new DeleteBucketCommand({ Bucket: options.bucket }));
  });
  return options;
}
