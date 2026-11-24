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
import { initializePostgresSchema } from "../../server/src/db/postgres/initialize.js";
import { openPostgresCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/postgres/open.js";
import { importCollaboration } from "../../server/src/storage-migration/collaboration.js";
import { importProduct } from "../../server/src/storage-migration/product.js";
import { prepareSource } from "../../server/src/storage-migration/source.js";
import { createPostgresTestDatabase, createPostgresTestSchema } from "../support/postgres/schema.js";

async function v30Source(resources: AsyncDisposableStack) {
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

it("reads committed V30 WAL rows without modifying the source files", async () => {
  await using resources = new AsyncDisposableStack();
  const source = await v30Source(resources);
  await source.checkSourceStopped();
  expect(source.product.prepare("PRAGMA user_version").get()?.user_version).toBe(30);
  expect(source.product.prepare("SELECT kind FROM users WHERE id='u'").get()?.kind).toBe("human");
});

it.each([24, 25, 26, 27, 28, 29, 31])("rejects product V%i before opening the collaboration database", async (version) => {
  await using resources = new AsyncDisposableStack();
  const directory = mkdtempSync(join(tmpdir(), "cutover-version-"));
  resources.defer(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "source.sqlite");
  const product = new DatabaseSync(path);
  product.exec(`PRAGMA user_version = ${version}`);
  product.close();
  const before = readFileSync(path);

  await expect(prepareSource(directory, path, join(directory, "missing"), resources))
    .rejects.toThrow(`Expected a V30 SQLite product database, got V${version}`);
  expect(readFileSync(path)).toEqual(before);
});

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
it.skipIf(!url)(
  "preserves Sheet blocks, snapshot references, Worktree baselines, seeds and comments",
  async () => {
    await using resources = new AsyncDisposableStack();
    const source = await v30Source(resources);
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

it.skipIf(!url)("imports executor access and nullable HTML View draft Worktree sources", async () => {
  await using resources = new AsyncDisposableStack();
  const product = new DatabaseSync(":memory:");
  resources.defer(() => product.close());
  product.exec(
    readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8"),
  );
  product.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
    INSERT INTO executor_access (user_id, granted_at) VALUES ('u', 1794900000000);
    INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);
    INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at) VALUES ('w', 'Draft', 'u', 'user', 'private', 1, 1);
    INSERT INTO html_view_drafts (id, author_user_id, idempotency_key, kind, space_id, name, object_key, byte_size, sha256, state, expires_at, created_at, updated_at, source_worktree_id)
      VALUES ('linked', 'u', 'linked', 'create', 's', 'Page', 'object-linked', 0, '${"a".repeat(64)}', 'receiving', 999, 1, 1, 'w'),
             ('unlinked', 'u', 'unlinked', 'create', 's', 'Page', 'object-unlinked', 0, '${"a".repeat(64)}', 'receiving', 999, 1, 1, NULL);
  `);
  const target = await createPostgresTestSchema(url!);
  resources.defer(target.close);
  await initializePostgresSchema(target.pool);
  const client = await target.pool.connect();
  resources.defer(() => client.release());
  const { rows: [{ schema }] } = await client.query("SELECT current_schema() AS schema");

  expect(await importProduct(product, client, schema)).toBe(6);
  expect((await client.query("SELECT id, source_worktree_id FROM html_view_drafts ORDER BY id")).rows).toEqual([
    { id: "linked", source_worktree_id: "w" }, { id: "unlinked", source_worktree_id: null },
  ]);
  expect((await client.query("SELECT user_id, granted_at FROM executor_access")).rows).toEqual([
    { user_id: "u", granted_at: "1794900000000" },
  ]);
});

it.skipIf(!url)("imports forks and Issues before the Worktrees that link to them, and each Space's proposals setting", async () => {
  await using resources = new AsyncDisposableStack();
  const product = new DatabaseSync(":memory:");
  resources.defer(() => product.close());
  product.exec(
    readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8"),
  );
  product.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
    INSERT INTO spaces (id, type, name, slug, public_read, proposals, owner_user_id, created_at, updated_at) VALUES ('t', 'team', 'Team', 'team', 1, 'anyone', 'u', 1, 1);
    INSERT INTO forks (id, owner_user_id, upstream_space_id, name, created_at) VALUES ('f', 'u', 't', 'fix-totals', 2);
    INSERT INTO issues (id, space_id, number, title, state, author_user_id, created_at, updated_at) VALUES ('i', 't', 1, 'Fix totals', 'open', 'u', 2, 2);
    INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at, fork_id, issue_id) VALUES ('w', 'fix-totals', 'u', 'team', 't', 'private', 3, 3, 'f', 'i');
  `);
  const target = await createPostgresTestSchema(url!);
  resources.defer(target.close);
  await initializePostgresSchema(target.pool);
  const client = await target.pool.connect();
  resources.defer(() => client.release());
  const { rows: [{ schema }] } = await client.query("SELECT current_schema() AS schema");

  expect(await importProduct(product, client, schema)).toBe(5);
  expect((await client.query("SELECT id, owner_user_id, upstream_space_id, name, created_at FROM forks")).rows).toEqual([
    { id: "f", owner_user_id: "u", upstream_space_id: "t", name: "fix-totals", created_at: "2" },
  ]);
  expect((await client.query("SELECT id, fork_id, issue_id FROM worktrees")).rows).toEqual([{ id: "w", fork_id: "f", issue_id: "i" }]);
  expect((await client.query("SELECT id, proposals FROM spaces")).rows).toEqual([{ id: "t", proposals: "anyone" }]);
});

it.skipIf(!url)("imports the V24 copy source and Link Sharing columns, also for a copy stored above its source", async () => {
  await using resources = new AsyncDisposableStack();
  const product = new DatabaseSync(":memory:");
  resources.defer(() => product.close());
  product.exec(
    readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8"),
  );
  // "copy" is a root Node, so it is imported before "source", which sits in a folder.
  product.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
    INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);
    INSERT INTO nodes (id, space_id, parent_id, name, created_by, created_at, updated_at) VALUES ('folder', 's', NULL, 'Folder', 'u', 1, 1);
    INSERT INTO nodes (id, space_id, parent_id, name, created_by, created_at, updated_at) VALUES ('source', 's', 'folder', 'Source', 'u', 1, 1);
    INSERT INTO nodes (id, space_id, parent_id, name, created_by, created_at, updated_at, copied_from_node_id) VALUES ('copy', 's', NULL, 'Copy', 'u', 2, 2, 'source');
    INSERT INTO node_link_sharing (node_id, enabled, role, created_by, updated_by, created_at, updated_at, unverified_role, making_of_note)
      VALUES ('source', 1, 'viewer', 'u', 'u', 1, 1, 'editor', 'Built from the Q3 export.');
    INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at) VALUES ('w', 'Draft', 'u', 'user', 'private', 1, 1);
    INSERT INTO worktree_units (worktree_id, unit_id, resource_id, source, ordinal, added_at) VALUES ('w', 'unit', 'draft-resource', 'worktree', 0, 1);
    INSERT INTO worktree_node_intents (worktree_id, unit_id, node_id, target_space_id, name, unit_type, created_by, created_at, updated_at, copied_from_node_id)
      VALUES ('w', 'unit', 'draft-node', 's', 'Draft copy', 'sheet', 'u', 1, 1, 'source');
  `);
  const target = await createPostgresTestSchema(url!);
  resources.defer(target.close);
  await initializePostgresSchema(target.pool);
  const client = await target.pool.connect();
  resources.defer(() => client.release());
  const { rows: [{ schema }] } = await client.query("SELECT current_schema() AS schema");

  expect(await importProduct(product, client, schema)).toBe(9);

  expect((await client.query("SELECT id, copied_from_node_id FROM nodes ORDER BY id")).rows).toEqual([
    { id: "copy", copied_from_node_id: "source" },
    { id: "folder", copied_from_node_id: null },
    { id: "source", copied_from_node_id: null },
  ]);
  expect((await client.query("SELECT unverified_role, making_of_note FROM node_link_sharing")).rows).toEqual([
    { unverified_role: "editor", making_of_note: "Built from the Q3 export." },
  ]);
  expect((await client.query("SELECT copied_from_node_id FROM worktree_node_intents")).rows).toEqual([
    { copied_from_node_id: "source" },
  ]);
});
