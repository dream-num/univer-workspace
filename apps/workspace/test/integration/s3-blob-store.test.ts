import { createHash, randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3BlobStore } from "../../server/src/integrations/blob/s3-blob-store.js";

const bucket = "workspace-test";
const cleanups: Array<() => void | Promise<void>> = [];

async function serve(
  respond: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void
) {
  const server = createServer((request, response) => {
    Promise.resolve(respond(request, response)).catch((error: Error) => response.destroy(error));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test endpoint port");
  cleanups.push(() => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }));
  return (prefix?: string) => {
    const store = new S3BlobStore({
      bucket, region: "us-east-1", endpoint: `http://127.0.0.1:${address.port}`,
      forcePathStyle: true, ...(prefix ? { prefix } : {}),
    });
    cleanups.push(() => store.dispose());
    return store;
  };
}

beforeEach(() => {
  vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key");
  vi.stubEnv("AWS_MAX_ATTEMPTS", "1");
});

afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    vi.unstubAllEnvs();
  }
});

describe("S3 BlobStore", () => {
  it("uploads the original bytes and keeps identical keys isolated by prefix", async () => {
    const objects = new Map<string, Buffer>();
    const connect = await serve(async (request, response) => {
      const { pathname } = new URL(request.url!, "http://localhost");
      if (request.method === "PUT") {
        objects.set(pathname, await buffer(request));
        response.writeHead(200, { ETag: '"provider-etag"' }).end();
      } else if (request.method === "DELETE") {
        objects.delete(pathname);
        response.writeHead(204).end();
      } else {
        response.writeHead(400).end();
      }
    });
    const first = connect("tenants/one");
    const second = connect("tenants/two");
    const key = randomUUID();
    const chunks = [Buffer.from("%P"), Buffer.from("DF-1.7")];
    const bytes = Buffer.concat(chunks);
    const stored = await first.put({
      objectKey: key, body: Readable.from(chunks), expectedByteSize: bytes.length,
    });
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(stored).toMatchObject({
      byteSize: bytes.length,
      sha256: digest,
      mediaType: "application/pdf",
      etag: digest,
    });
    const secondBytes = Buffer.from("second");
    const asset = await second.put({
      objectKey: key, body: Readable.from([secondBytes]), expectedByteSize: secondBytes.length,
      detectMediaType: false,
    });
    expect(asset).not.toHaveProperty("mediaType");
    const path = (prefix: string) => `/${bucket}/tenants/${prefix}/${key}`;
    expect(objects.get(path("one"))).toEqual(bytes);
    expect(objects.get(path("two"))).toEqual(secondBytes);
    await first.delete(key);
    await first.delete(key);
    expect([...objects.entries()]).toEqual([[path("two"), secondBytes]]);
    await expect(first.head(`../two/${key}`)).rejects.toThrow(/invalid blob object key/i);
  });

  it("writes a zero-byte object", async () => {
    let received: Buffer | undefined;
    const connect = await serve(async (request, response) => {
      if (request.method === "PUT") received = await buffer(request);
      response.writeHead(200, { ETag: '"empty-object"' }).end();
    });
    const stored = await connect().put({
      objectKey: randomUUID(), body: Readable.from([]), expectedByteSize: 0,
    });
    expect(received).toEqual(Buffer.alloc(0));
    expect(stored).toMatchObject({
      byteSize: 0, sha256: createHash("sha256").digest("hex"), mediaType: "application/octet-stream",
    });
  });

  it("defers cleanup until the unfinished upload has committed its bytes", async () => {
    const key = randomUUID();
    const events = new EventEmitter();
    const received = once(events, "received");
    const released = once(events, "release");
    const objects = new Set<string>();
    let deletions = 0;
    const connect = await serve(async (request, response) => {
      const { pathname } = new URL(request.url!, "http://localhost");
      if (request.method === "PUT") {
        await buffer(request);
        events.emit("received");
        await released;
        objects.add(pathname);
        response.writeHead(200, { ETag: '"uploaded-object"' }).end();
      } else if (request.method === "DELETE") {
        deletions++;
        objects.delete(pathname);
        response.writeHead(204).end();
      } else {
        response.writeHead(400).end();
      }
    });
    const store = connect();
    const upload = store.put({ objectKey: key, body: Readable.from(["x"]), expectedByteSize: 1 });
    await received;
    try {
      await expect(store.delete(key)).rejects.toThrow();
      expect(deletions).toBe(0);
    } finally {
      events.emit("release");
      await upload;
    }
    await store.delete(key);
    expect(deletions).toBe(1);
    expect(objects.size).toBe(0);
  });

  it("preserves total size for ranged reads, and can read an empty object", async () => {
    const key = randomUUID();
    const empty = randomUUID();
    const seen: Array<[string, string | undefined]> = [];
    const connect = await serve((request, response) => {
      const { pathname } = new URL(request.url!, "http://localhost");
      seen.push([pathname, request.headers.range]);
      if (pathname === `/${bucket}/${key}` && request.headers.range === "bytes=2-4") {
        response.writeHead(206, { "Content-Range": "bytes 2-4/9", "Content-Length": "3" }).end("cde");
      } else if (pathname === `/${bucket}/${empty}` && !request.headers.range) {
        response.writeHead(200, { "Content-Length": "0" }).end();
      } else {
        response.writeHead(404).end();
      }
    });
    const store = connect();
    const partial = await store.open({ objectKey: key, start: 2, end: 4 });
    expect(partial).toMatchObject({ totalByteSize: 9, start: 2, end: 4 });
    expect(await buffer(partial.stream)).toEqual(Buffer.from("cde"));
    expect(await store.head(empty)).toEqual({ byteSize: 0 });
    const opened = await store.open({ objectKey: empty });
    expect(opened.totalByteSize).toBe(0);
    expect(await buffer(opened.stream)).toEqual(Buffer.alloc(0));
    const missing = randomUUID();
    expect(await store.head(missing)).toBeNull();
    await expect(store.open({ objectKey: missing })).rejects.toThrow();
    expect(seen).toContainEqual([`/${bucket}/${key}`, "bytes=2-4"]);
  });

  it("propagates storage permission errors on HEAD", async () => {
    const connect = await serve((_, response) => { response.writeHead(403).end(); });
    await expect(connect().head(randomUUID())).rejects.toThrow();
  });

  it("rejects an entire object returned for a range request", async () => {
    const connect = await serve((_, response) => {
      response.writeHead(200, { "Content-Length": "4" }).end("abcd");
    });
    await expect(connect().open({ objectKey: randomUUID(), start: 1, end: 2 })).rejects.toThrow();
  });

  it("never publishes input shorter or longer than the reserved size", async () => {
    const objects = new Map<string, Buffer>();
    const connect = await serve(async (request, response) => {
      const { pathname } = new URL(request.url!, "http://localhost");
      if (request.method === "PUT") objects.set(pathname, await buffer(request));
      if (request.method === "DELETE") objects.delete(pathname);
      response.writeHead(200, { ETag: '"short-put"' }).end();
    });
    const store = connect();
    const key = randomUUID();
    for (const expectedByteSize of [0, 2]) {
      await expect(store.put({
        objectKey: key, body: Readable.from([Buffer.from("x")]), expectedByteSize,
      })).rejects.toThrow();
    }
    expect(objects.size).toBe(0);
    await store.delete(key);
  });

  it("aborts an in-flight multipart upload when its source breaks", async () => {
    const key = randomUUID();
    const events = new EventEmitter();
    const firstPartUploaded = once(events, "part");
    const operations: string[] = [];
    const connect = await serve(async (request, response) => {
      const { pathname, searchParams } = new URL(request.url!, "http://localhost");
      if (pathname !== `/${bucket}/${key}`) return void response.writeHead(404).end();
      if (request.method === "POST" && searchParams.has("uploads")) {
        operations.push("create");
        response.setHeader("Content-Type", "application/xml");
        response.end("<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>");
      } else if (request.method === "PUT" && searchParams.get("uploadId") === "test-upload") {
        await buffer(request);
        operations.push("part");
        response.writeHead(200, { ETag: '"uploaded-part"' }).end();
        events.emit("part");
      } else if (request.method === "DELETE" && searchParams.get("uploadId") === "test-upload") {
        operations.push("abort");
        response.writeHead(204).end();
      } else {
        operations.push("unexpected");
        response.writeHead(400).end();
      }
    });
    const chunk = Buffer.alloc(1024 * 1024);
    const sourceError = new Error("source disconnected");
    const body = Readable.from((async function* () {
      for (let i = 0; i < 16; i++) yield chunk;
      await firstPartUploaded;
      throw sourceError;
    })());
    const store = connect();
    await expect(store.put({ objectKey: key, body, expectedByteSize: chunk.length * 17 })).rejects.toBe(sourceError);
    await vi.waitFor(() => expect(operations).toContain("abort"));
    expect(operations).toContain("part");
    expect(operations).not.toContain("unexpected");
  });
});
