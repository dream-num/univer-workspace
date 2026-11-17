import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteCommentDatabaseAdapter } from "@univerjs-pro/collaboration-comment-database-sqlite";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { encode } from "@msgpack/msgpack";
import { copySheetBlocks } from "../../server/src/storage-migration/sheet-blocks.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { openPostgresCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/postgres/open.js";
import { importCollaboration } from "../../server/src/storage-migration/collaboration.js";
import { prepareSource } from "../../server/src/storage-migration/source.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

async function v21Source(resources: AsyncDisposableStack) {
  const directory = mkdtempSync(join(tmpdir(), "cutover-test-"));
  resources.defer(() => rmSync(directory, { recursive: true, force: true }));
  const productFile = join(directory, "old-product");
  const product = new DatabaseSync(productFile);
  resources.defer(() => product.close());
  product.exec(
    readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8"),
  );
  product.exec(`PRAGMA journal_mode=WAL;
    INSERT INTO users(id,username,display_name,created_at,updated_at) VALUES ('u','owner','Owner',1,1)`);
  const collaborationFile = join(directory, "old-collaboration");
  const db = new DatabaseSync(collaborationFile);
  db.exec(
    readFileSync(new URL("../fixtures/collaboration-rc/schema.sql", import.meta.url), "utf8"),
  );
  db.exec(readFileSync(new URL("../fixtures/collaboration-rc/data.sql", import.meta.url), "utf8"));
  db.exec(`INSERT INTO collaboration_worktree_units
    (removed,worktree_id,unit_id,unit_order,type,source,baseline_trunk_revision,draft_head_revision)
    VALUES (0,'pending-worktree','new-unit',1,1,'worktree',1,1);
    INSERT INTO collaboration_worktree_unit_seeds(worktree_id,unit_id,snapshot_json)
    SELECT 'pending-worktree','new-unit',payload_json FROM collaboration_snapshots WHERE unit_id='legacy-doc'`);
  db.exec(`INSERT INTO collaboration_units (unit_id, type, head_revision) VALUES ('sheet/A', 2, 1)`);
  db.prepare("INSERT INTO collaboration_sheet_blocks (unit_id, block_id, payload_json) VALUES (?, ?, ?)")
    .run("sheet/A", "block/B", JSON.stringify({ id: "block/B", startRow: 0, endRow: 0, data: { __univerCollaborationBinary: "AQI=" } }));
  db.prepare("INSERT INTO collaboration_snapshots (unit_id, revision, type, payload_json) VALUES (?, 1, 2, ?)")
    .run("sheet/A", JSON.stringify({ unitID: "sheet/A", type: 2, rev: 1, workbook: { blockMeta: { tab: { sheetID: "tab", blocks: ["block/B"] } } } }));
  db.close();
  const comments = new SQLiteCommentDatabaseAdapter({ filename: collaborationFile });
  try {
    const comment = {
      unitID: "legacy-doc",
      threadID: "thread",
      authorUserID: "u",
      content: "keep",
      mentions: ["viewer"],
    };
    await comments.createRoot(comment, { userID: "u", customData: {}, request: comment });
  } finally {
    await comments.dispose();
  }
  const originals = () =>
    readdirSync(directory)
      .filter((name) => name.startsWith("old-"))
      .sort()
      .map((name) => [name, readFileSync(join(directory, name))]);
  const before = originals();
  const source = await prepareSource(directory, productFile, collaborationFile, resources);
  expect(originals()).toEqual(before);
  return source;
}

it("reads committed V21 WAL rows without modifying the source files", async () => {
  await using resources = new AsyncDisposableStack();
  const source = await v21Source(resources);
  await source.checkSourceStopped();
  expect(source.product.prepare("PRAGMA user_version").get()?.user_version).toBe(21);
  expect(source.product.prepare("SELECT kind FROM users WHERE id='u'").get()?.kind).toBe("human");
});

it.each([19, 20, 22])("rejects product V%i before opening the collaboration database", async (version) => {
  await using resources = new AsyncDisposableStack();
  const directory = mkdtempSync(join(tmpdir(), "cutover-version-"));
  resources.defer(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "source.sqlite");
  const product = new DatabaseSync(path);
  product.exec(`PRAGMA user_version = ${version}`);
  product.close();
  const before = readFileSync(path);

  await expect(prepareSource(directory, path, join(directory, "missing"), resources))
    .rejects.toThrow(`Expected a V21 SQLite product database, got V${version}`);
  expect(readFileSync(path)).toEqual(before);
});

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
it.skipIf(!url)(
  "preserves Sheet blocks, snapshot references, Worktree baselines, seeds and comments",
  async () => {
    await using resources = new AsyncDisposableStack();
    const source = await v21Source(resources);
    const target = await createPostgresTestDatabase(url!);
    resources.defer(target.close);
    const storage = await createTestBucket(resources);
    const adapters = await openPostgresCollaborationDatabase(target.connectionString, storage);
    resources.defer(() => adapters.close());
    const pool = new Pool({ connectionString: target.connectionString });
    resources.defer(() => pool.end());
    const client = await pool.connect();
    resources.defer(() => client.release());
    const s3 = new S3Client(storage);
    resources.defer(() => s3.destroy());
    const key = { Bucket: storage.bucket, Key: "workspace/sheet-blocks/sheet%2FA/block%2FB" };
    expect(await copySheetBlocks(source, storage)).toBe(1);
    expect(await copySheetBlocks(source, storage)).toBe(1);
    const block = { id: "block/B", startRow: 0, endRow: 0, data: Uint8Array.of(1, 2) };
    const object = await s3.send(new GetObjectCommand(key));
    expect(Buffer.from((await object.Body!.transformToByteArray()))).toEqual(Buffer.from(encode(block)));
    await importCollaboration(source, client);
    const context = { userID: "u", customData: {}, request: {} };
    expect(await adapters.core.getSheetBlock(context, "sheet/A", "block/B")).toEqual(block);
    expect((await client.query("SELECT block_ids FROM collaboration.snapshots WHERE unit_id = 'sheet/A'")).rows)
      .toEqual([{ block_ids: ["block/B"] }]);
    await s3.send(new PutObjectCommand({ ...key, Body: "different" }));
    await expect(copySheetBlocks(source, storage)).rejects.toThrow(/contents differ/);
    const threads = { unitID: "legacy-doc", threadIDs: ["thread"] };
    expect(
      await adapters.comment.listThreads(threads, { ...context, request: threads }),
    ).toMatchObject([{ content: "keep", mentions: ["viewer"] }]);
    const id = "pending-worktree";
    expect(
      (await adapters.worktree.getWorktreeUnit(context, id, "legacy-doc"))?.baselineTrunkRevision,
    ).toBe(1);
    expect(await adapters.worktree.getWorktreeUnit(context, id, "new-unit")).not.toHaveProperty(
      "baselineTrunkRevision",
    );
    expect(await adapters.worktree.getUnitSeed(context, id, "new-unit")).toEqual(
      await source.worktree.getUnitSeed(context, id, "new-unit"),
    );
  },
);
