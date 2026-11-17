import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteCommentDatabaseAdapter } from "@univerjs-pro/collaboration-comment-database-sqlite";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { openPostgresCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/postgres/open.js";
import { importCollaboration } from "../../server/src/storage-migration/collaboration.js";
import { prepareSource } from "../../server/src/storage-migration/source.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

async function legacySource(resources: AsyncDisposableStack) {
  const directory = mkdtempSync(join(tmpdir(), "cutover-test-"));
  resources.defer(() => rmSync(directory, { recursive: true, force: true }));
  const productFile = join(directory, "old-product");
  const product = new DatabaseSync(productFile);
  resources.defer(() => product.close());
  product.exec(
    readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8"),
  );
  product.exec(`DROP TABLE node_reports; DROP TABLE agents; ALTER TABLE users DROP COLUMN kind;
    DROP TABLE skill_drafts; PRAGMA user_version=19; PRAGMA journal_mode=WAL;
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

it("upgrades only staging copies, including committed rows still in the V19 WAL", async () => {
  await using resources = new AsyncDisposableStack();
  const source = await legacySource(resources);
  await source.checkSourceStopped();
  expect(source.product.prepare("PRAGMA user_version").get()?.user_version).toBe(21);
  expect(source.product.prepare("SELECT kind FROM users WHERE id='u'").get()?.kind).toBe("human");
});

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
it.skipIf(!url)(
  "preserves trunk baselines and converts the SQLite Worktree placeholder and binary seed",
  async () => {
    await using resources = new AsyncDisposableStack();
    const source = await legacySource(resources);
    const target = await createPostgresTestDatabase(url!);
    resources.defer(target.close);
    const adapters = await openPostgresCollaborationDatabase(target.connectionString);
    resources.defer(() => adapters.close());
    const pool = new Pool({ connectionString: target.connectionString });
    resources.defer(() => pool.end());
    const client = await pool.connect();
    resources.defer(() => client.release());
    await importCollaboration(source, client);
    const context = { userID: "u", customData: {}, request: {} };
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
