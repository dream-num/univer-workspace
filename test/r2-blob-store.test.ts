import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { R2BlobStore, detectMediaType } from "../src/integrations/r2-blob-store.ts";

function createMockR2Bucket(): R2Bucket {
  const objects = new Map<string, { bytes: Uint8Array; httpMetadata?: Record<string, string>; etag: string }>();

  return {
    async put(key: string, value: any, options?: any): Promise<R2Object> {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const etag = options?.sha256 || "mock-etag";
      objects.set(key, {
        bytes,
        httpMetadata: options?.httpMetadata,
        etag
      });
      return {
        key,
        size: bytes.byteLength,
        etag,
        httpEtag: etag,
        writeHttpMetadata: (headers: Headers) => {
          if (options?.httpMetadata?.contentType) {
            headers.set("content-type", options.httpMetadata.contentType);
          }
        }
      } as any;
    },
    async get(key: string, options?: any): Promise<R2ObjectBody | null> {
      const stored = objects.get(key);
      if (!stored) return null;

      let slice = stored.bytes;
      if (options?.range) {
        const offset = options.range.offset || 0;
        const length = options.range.length !== undefined ? options.range.length : stored.bytes.length - offset;
        slice = stored.bytes.subarray(offset, offset + length);
      }

      return {
        key,
        size: slice.byteLength,
        etag: stored.etag,
        httpEtag: stored.etag,
        body: slice,
        writeHttpMetadata: (headers: Headers) => {
          if (stored.httpMetadata?.contentType) {
            headers.set("content-type", stored.httpMetadata.contentType);
          }
        }
      } as any;
    },
    async head(key: string): Promise<R2Object | null> {
      const stored = objects.get(key);
      if (!stored) return null;
      return {
        key,
        size: stored.bytes.byteLength,
        etag: stored.etag,
        httpEtag: stored.etag
      } as any;
    },
    async delete(keys: string | string[]): Promise<void> {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) objects.delete(k);
    }
  } as any;
}

describe("Cloudflare R2 Blob Storage", () => {
  test("detects media types correctly", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(detectMediaType(png), "image/png");

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    assert.equal(detectMediaType(jpeg), "image/jpeg");

    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    assert.equal(detectMediaType(pdf), "application/pdf");
  });

  test("stores, retrieves with range, and deletes objects in R2", async () => {
    const bucket = createMockR2Bucket();
    const store = new R2BlobStore(bucket);

    const data = new TextEncoder().encode("Univer Workspace R2 Test Content");
    const stored = await store.put({
      objectKey: "test-sheet.txt",
      body: data
    });

    assert.equal(stored.byteSize, data.byteLength);
    assert.ok(stored.sha256);

    const headRes = await store.head("test-sheet.txt");
    assert.ok(headRes);
    assert.equal(headRes.byteSize, data.byteLength);

    // Retrieve entire object
    const getRes = await store.get("test-sheet.txt");
    assert.ok(getRes);
    const retrievedText = await getRes.text();
    assert.equal(retrievedText, "Univer Workspace R2 Test Content");

    // Range get
    const rangeRes = await store.get("test-sheet.txt", { offset: 0, length: 6 });
    assert.ok(rangeRes);
    const rangeText = await rangeRes.text();
    assert.equal(rangeText, "Univer");

    // Delete
    await store.delete("test-sheet.txt");
    const headAfter = await store.head("test-sheet.txt");
    assert.equal(headAfter, null);
  });
});
