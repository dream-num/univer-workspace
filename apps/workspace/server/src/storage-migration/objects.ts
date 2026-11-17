import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { GetObjectCommand, paginateListObjectsV2, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { SHEET_BLOCK_DIRECTORY } from "../integrations/univer/collaboration-database/postgres/sheet-block-storage.js";
import type { S3BlobStoreOptions } from "../integrations/blob/s3-blob-store.js";

async function digest(stream: AsyncIterable<Uint8Array>) {
  const hash = createHash("sha256");
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest("hex");
}

// A pending operation may need bytes even when no published Resource points at them yet.
const requiredObjects = `SELECT object_key, sha256, byte_size FROM blob_resources WHERE availability = 'ready'
  UNION ALL SELECT object_key, sha256, byte_size FROM univer_assets
  UNION ALL SELECT object_key, sha256, received_size FROM blob_upload_sessions WHERE state = 'uploaded'
  UNION ALL SELECT object_key, sha256, received_size FROM univer_asset_uploads WHERE state = 'stored'
  UNION ALL SELECT object_key, sha256, byte_size FROM html_view_drafts WHERE state = 'pending'
  UNION ALL SELECT json_extract(f.value,'$.objectKey'), json_extract(f.value,'$.sha256'), json_extract(f.value,'$.byteSize')
    FROM skill_drafts d, json_each(d.files) f WHERE d.state = 'pending'`;

export async function copyObjects(
  db: DatabaseSync,
  directory: string,
  options: S3BlobStoreOptions,
): Promise<number> {
  const { bucket, prefix, ...clientOptions } = options;
  const client = new S3Client(clientOptions);
  const prefixPath = prefix ? prefix + "/" : "";
  try {
    const local = new Set<string>();
    // LocalBlobStore creates the directory on the first upload; a fresh installation may lack it.
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (
          error.code === "ENOENT" &&
          !db.prepare("SELECT 1 FROM (" + requiredObjects + ") LIMIT 1").get()
        )
          return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (!/^[0-9a-f-]{36}$/.test(entry.name)) continue;
      if (!entry.isFile()) throw new Error(`Expected a regular local object file: ${entry.name}`);
      local.add(entry.name);
    }
    const existing = new Set<string>();
    for await (const page of paginateListObjectsV2(
      { client },
      { Bucket: bucket, Prefix: prefixPath },
    )) {
      for (const item of page.Contents ?? []) {
        const name = item.Key!.slice(prefixPath.length);
        if (name.startsWith(SHEET_BLOCK_DIRECTORY + "/")) continue; // Validated by copySheetBlocks.
        if (!local.has(name))
          throw new Error("Destination S3 prefix contains an object outside this migration");
        existing.add(name);
      }
    }
    const verified = new Map<string, { sha: string; size: number }>();
    for (const name of local) {
      const file = join(directory, name);
      const size = (await stat(file)).size;
      const location = { Bucket: bucket, Key: prefixPath + name };
      const sha = await digest(createReadStream(file));
      if (!existing.has(name)) {
        await new Upload({
          client,
          params: {
            ...location,
            IfNoneMatch: "*",
            Body: createReadStream(file),
            ContentLength: size,
          },
        }).done();
      }
      const remote = await client.send(new GetObjectCommand(location));
      if (
        !remote.Body ||
        (await digest(remote.Body.transformToWebStream())) !== sha ||
        remote.ContentLength !== size
      ) {
        throw new Error(`Destination S3 contents differ for ${name}`);
      }
      verified.set(name, { sha, size });
    }
    for (const row of db.prepare(requiredObjects).iterate()) {
      const actual = verified.get(String(row.object_key));
      if (!actual || actual.sha !== row.sha256 || actual.size !== row.byte_size) {
        throw new Error(`Missing or inconsistent object for product reference ${row.object_key}`);
      }
    }
    return local.size;
  } finally {
    client.destroy();
  }
}
