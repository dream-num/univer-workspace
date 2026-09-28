import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LocalBlobStore } from "../../server/src/integrations/blob/blob-store.js";

describe("Blob MIME UTF-8 sampling", () => {
  it("accepts incomplete sample tails only when more bytes follow", async () => {
    const directory = mkdtempSync(join(tmpdir(), "markdown-mime-"));
    try {
      const store = new LocalBlobStore(directory);
      for (const [body, expected] of [
        [Buffer.from("中".repeat(3000)), "text/plain; charset=utf-8"],
        [Buffer.from("😀".repeat(3000)), "text/plain; charset=utf-8"],
        [
          Buffer.concat([Buffer.from("a".repeat(8191)), Buffer.from("😀")]),
          "text/plain; charset=utf-8",
        ],
        [Buffer.from([0xe4, 0xb8]), "application/octet-stream"],
        [Buffer.from([0xff, 0, 1]), "application/octet-stream"],
      ] as const) {
        const result = await store.put({
          objectKey: randomUUID(),
          expectedByteSize: body.length,
          body: Readable.from([body]),
        });
        expect(result.mediaType).toBe(expected);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
