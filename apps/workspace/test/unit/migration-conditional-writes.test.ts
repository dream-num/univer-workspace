import { Readable } from "node:stream";
import { CompleteMultipartUploadCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { expect, it } from "vitest";
import { prepareMigrationWrites } from "../../server/src/storage-migration/conditional-writes.js";

const ossEndpoint = "https://oss-cn-shenzhen-internal.aliyuncs.com";
const bucket = "workspace-test";

function captureRequests(versioning?: string, rejectVersionRead = false) {
  const writes: Record<string, string>[] = [];
  const client = new S3Client({
    region: "us-east-1", credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: {
      async handle(request) {
        const versionCheck = Object.hasOwn(request.query ?? {}, "versioning");
        if (versionCheck && rejectVersionRead) {
          return { response: { statusCode: 403, headers: {}, body: Readable.from([
            Buffer.from("<Error><Code>AccessDenied</Code></Error>"),
          ]) } };
        }
        if (!versionCheck) writes.push(request.headers);
        const xml = versionCheck
          ? `<VersioningConfiguration>${versioning ? `<Status>${versioning}</Status>` : ""}</VersioningConfiguration>`
          : "<CompleteMultipartUploadResult/>";
        return { response: { statusCode: 200, headers: {}, body: Readable.from([Buffer.from(xml)]) } };
      },
    },
  });
  return { client, writes };
}

it.each([
  [ossEndpoint, "x-oss-forbid-overwrite", "true", "if-none-match"],
  ["https://s3.us-east-1.amazonaws.com", "if-none-match", "*", "x-oss-forbid-overwrite"],
])("serializes create-only PUT and multipart completion for %s", async (endpoint, header, value, absent) => {
  const { client, writes } = captureRequests();
  try {
    await prepareMigrationWrites(client, { bucket, endpoint });
    const target = { Bucket: bucket, Key: "new-key", IfNoneMatch: "*" };
    await client.send(new PutObjectCommand({ ...target, Body: Buffer.from("payload") }));
    await client.send(new CompleteMultipartUploadCommand({ ...target, UploadId: "id", MultipartUpload: { Parts: [] } }));
    expect(writes).toHaveLength(2);
    for (const headers of writes) {
      expect(headers[header]).toBe(value);
      expect(headers[absent]).toBeUndefined();
      expect(headers.authorization).toContain(header);
    }
  } finally {
    client.destroy();
  }
});

it.each(["Enabled", "Suspended"])("stops before uploading to an OSS bucket with %s versioning", async (status) => {
  const { client, writes } = captureRequests(status);
  try {
    await expect(prepareMigrationWrites(client, { bucket, endpoint: ossEndpoint })).rejects.toThrow(status);
    expect(writes).toHaveLength(0);
  } finally {
    client.destroy();
  }
});

it("propagates a failed versioning check before any writes", async () => {
  const { client, writes } = captureRequests(undefined, true);
  try {
    await expect(prepareMigrationWrites(client, { bucket, endpoint: ossEndpoint })).rejects.toMatchObject({ name: "AccessDenied" });
    expect(writes).toHaveLength(0);
  } finally {
    client.destroy();
  }
});

it.each([16, 5 * 1024 * 1024 + 1])("rejects repeated Upload writes of %i bytes on OSS", async (size) => {
  let stored: Buffer | undefined;
  let pending: Buffer[] = [];
  const client = new S3Client({
    region: "us-east-1", maxAttempts: 1,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: {
      async handle(request) {
        let statusCode = 200;
        let xml = "";
        const query = request.query ?? {};
        if (Object.hasOwn(query, "versioning")) xml = "<VersioningConfiguration/>";
        else if (Object.hasOwn(query, "uploads")) {
          pending = [];
          xml = "<InitiateMultipartUploadResult><UploadId>test</UploadId></InitiateMultipartUploadResult>";
        } else if (request.method === "DELETE") {
          pending = [];
        } else if (request.method === "PUT" && query.uploadId) {
          pending[Number(query.partNumber) - 1] = Buffer.from(request.body as Uint8Array);
        } else {
          expect(request.headers["if-none-match"]).toBeUndefined();
          expect(request.headers["x-oss-forbid-overwrite"]).toBe("true");
          if (stored) {
            statusCode = 409;
            xml = "<Error><Code>FileAlreadyExists</Code></Error>";
          } else {
            stored = request.method === "POST" ? Buffer.concat(pending) : Buffer.from(request.body as Uint8Array);
            xml = "<CompleteMultipartUploadResult/>";
          }
        }
        return { response: { statusCode, headers: { etag: '"part"' }, body: Readable.from([Buffer.from(xml)]) } };
      },
    },
  });
  const write = (value: number) => new Upload({
    client, params: {
      Bucket: bucket, Key: "probe", IfNoneMatch: "*",
      Body: Readable.from([Buffer.alloc(size, value)]), ContentLength: size,
    },
  }).done();
  try {
    await prepareMigrationWrites(client, { bucket, endpoint: ossEndpoint });
    await write(65);
    await expect(write(66)).rejects.toMatchObject({ name: "FileAlreadyExists" });
    expect(stored?.equals(Buffer.alloc(size, 65))).toBe(true);
  } finally {
    client.destroy();
  }
});
