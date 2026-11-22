import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openProductDatabase } from "../../server/src/db/index.js";
import { createPostgresTestSchema } from "../support/postgres/schema.js";

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;

it.skipIf(!url)("stores draft sources, counts unexpired pending pages and publishes once under concurrent decisions", async () => {
  await using resources = new AsyncDisposableStack();
  const schema = await createPostgresTestSchema(url!);
  resources.defer(schema.close);
  const database = await openProductDatabase({ provider: "postgres", connectionString: schema.connectionString });
  resources.defer(() => database.close());
  await schema.pool.query(`
    INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
    INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);
    INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at) VALUES ('w', 'Source', 'u', 'user', 'private', 1, 1);
  `);
  const drafts = database.repositories.htmlViewDrafts;
  const now = Date.now();
  const { row } = await drafts.reserve({
    author_user_id: "u", idempotency_key: randomUUID(), kind: "create", space_id: "s",
    source_worktree_id: "w", parent_node_id: null, name: "Page.univer.html",
    target_resource_id: null, base_etag: null, sha256: "a".repeat(64), byte_size: 3,
  }, now);
  expect((await drafts.find(row.id))?.source_worktree_id).toBe("w");
  expect((await database.repositories.worktrees.get("w", "u"))?.pending_page_drafts).toBe(0);
  await drafts.markPending(row.id, { mediaType: "text/html", etag: "etag", byteSize: 3, sha256: "a".repeat(64) }, now);
  expect((await database.repositories.worktrees.get("w", "u"))?.pending_page_drafts).toBe(1);
  expect((await drafts.pendingForWorktree("w")).map((row) => row.id)).toEqual([row.id]);
  await schema.pool.query("UPDATE html_view_drafts SET expires_at = 1 WHERE id = $1", [row.id]);
  expect((await database.repositories.worktrees.get("w", "u"))?.pending_page_drafts).toBe(0);
  await schema.pool.query("UPDATE html_view_drafts SET expires_at = $2 WHERE id = $1", [row.id, now + 86400000]);
  const decided = await Promise.all([drafts.decide(row.id, "u", "publish", now), drafts.decide(row.id, "u", "publish", now)]);
  expect(decided[0]?.state).toBe("published");
  expect(decided[1]?.result_node_id).toBe(decided[0]?.result_node_id);
  expect((await schema.pool.query("SELECT id, created_by FROM nodes")).rows).toEqual([{ id: decided[0]?.result_node_id, created_by: "u" }]);
  expect(await drafts.pendingForWorktree("w")).toEqual([]);
  expect((await database.repositories.worktrees.get("w", "u"))?.pending_page_drafts).toBe(0);
});

it.skipIf(!url)("deduplicates concurrent revision reservations and supersedes once under competing uploads", async () => {
  await using resources = new AsyncDisposableStack();
  const schema = await createPostgresTestSchema(url!);
  resources.defer(schema.close);
  const database = await openProductDatabase({ provider: "postgres", connectionString: schema.connectionString });
  resources.defer(() => database.close());
  await schema.pool.query(`INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);`);
  const drafts = database.repositories.htmlViewDrafts;
  const now = Date.now();
  const intent = { author_user_id: "u", idempotency_key: randomUUID(), kind: "create" as const, space_id: "s",
    source_worktree_id: null, parent_node_id: null, name: "Page.univer.html", target_resource_id: null, base_etag: null,
    sha256: "a".repeat(64), byte_size: 3 };
  const stored = { mediaType: "text/html", etag: "etag", byteSize: 3, sha256: "a".repeat(64) };
  const previous = await drafts.reserve(intent, now);
  await drafts.markPending(previous.row.id, stored, now);
  const revision = { ...intent, idempotency_key: randomUUID(), revises_draft_id: previous.row.id };
  const retries = await Promise.all([drafts.reserve(revision, now), drafts.reserve(revision, now)]);
  expect(retries.map((result) => result.created).sort()).toEqual([false, true]);
  expect(retries[0]!.row.id).toBe(retries[1]!.row.id);
  const other = await drafts.reserve({ ...revision, idempotency_key: randomUUID() }, now);
  const completed = await Promise.allSettled([drafts.markPending(retries[0]!.row.id, stored, now), drafts.markPending(other.row.id, stored, now)]);
  expect(completed.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const winner = completed.find((result) => result.status === "fulfilled");
  if (winner?.status !== "fulfilled") throw new Error("Missing successful revision");
  expect(await drafts.find(previous.row.id)).toMatchObject({ state: "superseded", superseded_by: winner.value.id });
  expect(await drafts.markPending(winner.value.id, stored, now)).toMatchObject({ state: "pending" });
  expect((await drafts.decide(previous.row.id, "u", "publish", now)).state).toBe("superseded");
});
