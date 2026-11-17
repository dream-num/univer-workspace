import { GetObjectCommand, paginateListObjectsV2, PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3BlobStoreOptions } from "../integrations/blob/s3-blob-store.js";
import { sheetBlockStorage } from "../integrations/univer/collaboration-database/postgres/sheet-block-storage.js";
import type { Source } from "./source.js";

// The SDK stores the same MessagePack block bytes as SQLite, at this documented object key.
export async function copySheetBlocks(source: Source, options: S3BlobStoreOptions): Promise<number> {
  const { client, bucket, prefix } = sheetBlockStorage(options);
  try {
    const existing = new Set<string>();
    for await (const page of paginateListObjectsV2({ client }, { Bucket: bucket, Prefix: prefix + "/" })) {
      for (const item of page.Contents ?? []) existing.add(item.Key!);
    }
    let count = 0;
    for (const row of source.collaboration.prepare("SELECT unit_id, block_id, payload FROM collaboration_sheet_blocks").iterate()) {
      const unit = String(row.unit_id);
      const block = String(row.block_id);
      if ([unit, block].some(id => !id || id === "." || id === "..")) {
        throw new Error("Sheet block ID cannot be represented in an S3 object key");
      }
      const location = { Bucket: bucket, Key: `${prefix}/${encodeURIComponent(unit)}/${encodeURIComponent(block)}` };
      if (!(row.payload instanceof Uint8Array)) throw new Error("Expected a MessagePack Sheet block");
      const bytes = Buffer.from(row.payload);
      if (!existing.delete(location.Key)) {
        await client.send(new PutObjectCommand({ ...location, Body: bytes, ContentType: "application/vnd.msgpack", IfNoneMatch: "*" }));
      }
      const response = await client.send(new GetObjectCommand(location));
      const stored = await response.Body?.transformToByteArray();
      if (!stored || !bytes.equals(stored)) throw new Error(`Destination S3 contents differ for ${location.Key}`);
      count++;
    }
    if (existing.size) throw new Error("Destination contains Sheet block objects outside this migration");
    return count;
  } finally {
    client.destroy();
  }
}
