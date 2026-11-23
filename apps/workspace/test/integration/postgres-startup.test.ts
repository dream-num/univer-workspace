import { describe, expect, it, onTestFinished } from "vitest";
import type { Pool } from "pg";
import { openProductDatabase } from "../../server/src/db/index.js";
import { productSchemaFingerprint } from "../../server/src/db/postgres/initialize.js";
import { loadConfig } from "../../server/src/config.js";
import { createPostgresTestSchema } from "../support/postgres/schema.js";
import { withoutV24Columns } from "../support/v24-downgrade.js";

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;

it("requires an explicit PostgreSQL provider and connection URL", () => {
  expect(loadConfig({ DATABASE_URL: "postgres://host/db" }).database.provider).toBe("sqlite");
  expect(() => loadConfig({ PRODUCT_DATABASE_PROVIDER: "postgres" })).toThrow(/Remove PRODUCT_DATABASE_PROVIDER/);
  expect(() => loadConfig({ DATABASE_PROVIDER: "other" })).toThrow(/PROVIDER/);
  expect(() => loadConfig({ DATABASE_PROVIDER: "postgres" })).toThrow(/DATABASE_URL/);
  expect(() => loadConfig({ DATABASE_PROVIDER: "postgres", DATABASE_URL: "file:///tmp/db" })).toThrow(/DATABASE_URL/);
  expect(() => loadConfig({ DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://host/db" })).toThrow(/BLOB_STORE=s3/);
  expect(loadConfig({ DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://host/db", BLOB_STORE: "s3", BLOB_S3_BUCKET: "test" }).database)
    .toEqual({ provider: "postgres", connectionString: "postgres://host/db" });
});

describe.skipIf(!url)("PostgreSQL startup", () => {
  it("serializes first starts, preserves rows on restart and rejects version or schema drift", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const config = { provider: "postgres" as const, connectionString: schema.connectionString };
    const databases = await Promise.all([openProductDatabase(config), openProductDatabase(config)]);
    await Promise.all(databases.map(db => db.close()));
    await schema.pool.query("INSERT INTO users (id,username,display_name,created_at,updated_at) VALUES ('id','kept','Kept',1,1)");
    const reopened = await openProductDatabase(config);
    try { expect(await reopened.repositories.identity.usernameExists("KEPT")).toBe(true); }
    finally { await reopened.close(); }
    await schema.pool.query("UPDATE workspace_product_schema SET version=8");
    await expect(openProductDatabase(config)).rejects.toThrow(/Unsupported/);
    await schema.pool.query("UPDATE workspace_product_schema SET version=7");
    await schema.pool.query("DROP INDEX users_username");
    await expect(openProductDatabase(config)).rejects.toThrow(/modified/);
    expect((await schema.pool.query("SELECT username FROM users")).rows).toEqual([{ username: "kept" }]);
  });

  it("upgrades version 1 by repairing display names and default Personal Space names once", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const config = { provider: "postgres" as const, connectionString: schema.connectionString };
    await (await openProductDatabase(config)).close();
    const fresh = (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows;
    await schema.pool.query(`
      INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES
        ('google', 'alice', 'alice@example.com', 1, 2), ('hostile', 'carol', E'Carol\\u202Eevil\\nname', 1, 2),
        ('filler', 'dave', E'\\u3164', 1, 2), ('custom', 'erin', 'Erin <erin@example.com>', 1, 2), ('plain', 'grace', 'Grace', 1, 2);
      INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES
        ('s-google', 'personal', 'alice@example.com 的个人空间', 'google', 3, 4), ('s-hostile', 'personal', E'Carol\\u202Eevil\\nname 的个人空间', 'hostile', 3, 4),
        ('s-filler', 'personal', E'\\u3164 的个人空间', 'filler', 3, 4), ('s-custom', 'personal', 'Erin''s drafts', 'custom', 3, 4),
        ('s-plain', 'personal', 'Grace 的个人空间', 'plain', 3, 4);
    `);
    const owners = [
      ["blank", "\u1160", "\u3164"],
      ...["\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} Smith", "Sam ❤\uFE0F", "نامه\u200Cای", "क्\u200Dष", " Ann  Lee "]
        .map((name, index) => [`kept${index}`, `kept${index}`, name]),
    ];
    for (const [id, username, name] of owners) {
      await schema.pool.query("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ($1, $2, $3, 1, 2)", [id, username, name]);
      await schema.pool.query("INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ($1, 'personal', $2, $3, 3, 4)", [`s-${id}`, `${name} 的个人空间`, id]);
    }
    const kept = <T extends { id: string }>(rows: T[]) => rows.filter(({ id }) => id.includes("kept"));
    const repaired = <T extends { id: string }>(rows: T[]) => rows.filter(({ id }) => !id.includes("kept"));
    await downgrade(schema, 1);
    const snapshot = async () => ({
      users: (await schema.pool.query("SELECT id, display_name, updated_at FROM users ORDER BY id")).rows,
      spaces: (await schema.pool.query("SELECT id, name, updated_at FROM spaces ORDER BY id")).rows,
      schema: (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows,
    });
    const before = await snapshot();
    await (await openProductDatabase(config)).close();
    const after = await snapshot();
    expect(repaired(after.users)).toEqual([
      { id: "blank", display_name: "Workspace User", updated_at: "2" },
      { id: "custom", display_name: "Erin <erin>", updated_at: "2" }, { id: "filler", display_name: "dave", updated_at: "2" },
      { id: "google", display_name: "alice", updated_at: "2" }, { id: "hostile", display_name: "Carolevil name", updated_at: "2" },
      { id: "plain", display_name: "Grace", updated_at: "2" },
    ]);
    expect(repaired(after.spaces)).toEqual([
      { id: "s-blank", name: "Workspace User 的个人空间", updated_at: "4" },
      { id: "s-custom", name: "Erin's drafts", updated_at: "4" }, { id: "s-filler", name: "dave 的个人空间", updated_at: "4" },
      { id: "s-google", name: "alice 的个人空间", updated_at: "4" }, { id: "s-hostile", name: "Carolevil name 的个人空间", updated_at: "4" },
      { id: "s-plain", name: "Grace 的个人空间", updated_at: "4" },
    ]);
    expect(kept(after.users)).toEqual(kept(before.users));
    expect(kept(after.spaces)).toEqual(kept(before.spaces));
    expect(kept(after.users)).toHaveLength(5);
    expect(after.schema).toEqual(fresh);

    await (await openProductDatabase(config)).close();
    expect(await snapshot()).toEqual(after);
    await downgrade(schema, 1);
    await (await openProductDatabase(config)).close();
    expect(await snapshot()).toEqual(after);
  });

  it("upgrades version 2 in place to the fresh-install structure, keeps rows, and rolls back a failed upgrade", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const start = async () => (await openProductDatabase({ provider: "postgres", connectionString: schema.connectionString })).close();
    const structure = async () => ({
      version: (await schema.pool.query("SELECT version, fingerprint FROM workspace_product_schema")).rows,
      columns: (await schema.pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position")).rows,
      constraints: (await schema.pool.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = current_schema()::regnamespace ORDER BY conname")).rows,
    });
    const users = async () => (await schema.pool.query("SELECT * FROM users ORDER BY id")).rows;

    await start();
    const fresh = await structure();
    expect(fresh.version).toMatchObject([{ version: 7 }]);
    await downgrade(schema, 2);
    await schema.pool.query("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1)");
    const before = await users();
    const v2 = await structure();

    // A sequence is outside the fingerprint and takes the new table's name, so the upgrade fails midway.
    await schema.pool.query("CREATE SEQUENCE executor_access");
    await expect(start()).rejects.toThrow(/executor_access/);
    expect(await structure()).toEqual(v2);
    await schema.pool.query("DROP SEQUENCE executor_access");

    await start();
    expect(await structure()).toEqual(fresh);
    expect(await users()).toEqual(before);
    await start();
    expect(await structure()).toEqual(fresh);
    expect(await users()).toEqual(before);

    await schema.pool.query("INSERT INTO executor_access (user_id, granted_at) VALUES ('u', 5)");
    await expect(schema.pool.query("INSERT INTO executor_access (user_id, granted_at) VALUES ('missing', 5)")).rejects.toThrow(/foreign key/);
    await schema.pool.query("DELETE FROM users WHERE id = 'u'");
    expect((await schema.pool.query("SELECT * FROM executor_access")).rows).toEqual([]);
  });

  it("upgrades version 3 in place to the fresh-install structure, keeps rows, and rolls back a failed upgrade", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const start = async () => (await openProductDatabase({ provider: "postgres", connectionString: schema.connectionString })).close();
    const structure = async () => ({
      version: (await schema.pool.query("SELECT version, fingerprint FROM workspace_product_schema")).rows,
      columns: (await schema.pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position")).rows,
      constraints: (await schema.pool.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = current_schema()::regnamespace ORDER BY conname")).rows,
    });
    const tables = ["nodes", "node_link_sharing", "worktree_node_intents", "operations"];
    const rows = async () => Promise.all(tables.map(async (table) =>
      withoutV24Columns(table, (await schema.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows)));

    await start();
    const fresh = await structure();
    await downgrade(schema, 3);
    await schema.pool.query(`
      INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
      INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);
      INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 's', 'Budget', 'u', 1, 1);
      INSERT INTO node_link_sharing (node_id, enabled, role, created_by, updated_by, created_at, updated_at) VALUES ('n', 1, 'editor', 'u', 'u', 1, 1);
      INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at) VALUES ('w', 'Draft', 'u', 'user', 'private', 1, 1);
      INSERT INTO worktree_units (worktree_id, unit_id, resource_id, source, ordinal, added_at) VALUES ('w', 'unit', 'draft-resource', 'worktree', 0, 1);
      INSERT INTO worktree_node_intents (worktree_id, unit_id, node_id, target_space_id, name, unit_type, created_by, created_at, updated_at)
        VALUES ('w', 'unit', 'draft-node', 's', 'Draft sheet', 'sheet', 'u', 1, 1);
      INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, lease_owner, lease_expires_at, created_at, updated_at)
        VALUES ('pending', 'create_blob_resource', 'u', 'reserved', 'pending', '{"a":1}', 2, 3, 'product-api', 9, 1, 2);
    `);
    const before = await rows();
    const v3 = await structure();
    expect(v3.version).toMatchObject([{ version: 3 }]);
    await expect(schema.pool.query("UPDATE operations SET kind = 'copy_node'")).rejects.toThrow(/operations_kind_check/);

    // A sequence is outside the fingerprint and takes the new index's name, so the upgrade fails midway.
    await schema.pool.query("CREATE SEQUENCE nodes_copied_from");
    await expect(start()).rejects.toThrow(/nodes_copied_from/);
    expect(await structure()).toEqual(v3);
    expect(await rows()).toEqual(before);
    await schema.pool.query("DROP SEQUENCE nodes_copied_from");

    await start();
    expect(await structure()).toEqual(fresh);
    expect(await rows()).toEqual(before);
    await start();
    expect(await structure()).toEqual(fresh);
    expect(await rows()).toEqual(before);

    await expect(schema.pool.query("UPDATE node_link_sharing SET unverified_role = 'owner'")).rejects.toThrow(/unverified_role/);
    await expect(schema.pool.query("UPDATE operations SET kind = 'move_node'")).rejects.toThrow(/operations_kind_check/);
    await schema.pool.query("UPDATE operations SET kind = 'copy_node'");
    await expect(schema.pool.query("UPDATE nodes SET copied_from_node_id = 'missing'")).rejects.toThrow(/foreign key/);
    await schema.pool.query(`
      INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('source', 's', 'Source', 'u', 1, 1);
      UPDATE nodes SET copied_from_node_id = 'source' WHERE id = 'n';
      DELETE FROM nodes WHERE id = 'source'`);
    expect((await schema.pool.query("SELECT copied_from_node_id FROM nodes WHERE id = 'n'")).rows).toEqual([{ copied_from_node_id: null }]);
  });

  it("upgrades version 4 by converging display names an earlier repair left, and rolls back a failed upgrade", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const config = { provider: "postgres" as const, connectionString: schema.connectionString };
    await (await openProductDatabase(config)).close();
    const fresh = (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows;
    const owners = [
      ["r1", "Al\uFFF9i\uFFFAc\uFFFBe", "Alice"],
      ["r2", "alice@example\u2024com", "alice"],
      ["r3", "\u0D05\u0D35\u0D28\u0D4D", "\u0D05\u0D35\u0D28\u0D4D"],
      ["r4", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Smith", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Smith"],
      ["r5", "\u{1F3F4}\u{E0068}\u{E0069}\u{E007F}", "\u{1F3F4}"],
    ] as const;
    for (const [id, name] of owners) {
      await schema.pool.query("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ($1, $1, $2, 1, 2)", [id, name]);
      await schema.pool.query("INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ($1, 'personal', $2, $3, 3, 4)", [`s-${id}`, `${name} 的个人空间`, id]);
    }
    await downgrade(schema, 4);
    const snapshot = async () => ({
      users: (await schema.pool.query("SELECT id, display_name, updated_at FROM users ORDER BY id")).rows,
      spaces: (await schema.pool.query("SELECT id, name, updated_at FROM spaces ORDER BY id")).rows,
      schema: (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows,
    });
    const before = await snapshot();

    const holder = await schema.pool.connect();
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE spaces IN SHARE MODE");
    const timed = new URL(schema.connectionString);
    timed.searchParams.set("options", `${timed.searchParams.get("options")} -c lock_timeout=500`);
    await expect(openProductDatabase({ ...config, connectionString: timed.href })).rejects.toThrow(/lock timeout/);
    await holder.query("ROLLBACK");
    holder.release();
    expect(await snapshot()).toEqual(before);

    await (await openProductDatabase(config)).close();
    const after = await snapshot();
    expect(after.users).toEqual(owners.map(([id, , name]) => ({ id, display_name: name, updated_at: "2" })));
    expect(after.spaces).toEqual(owners.map(([id, , name]) => ({ id: `s-${id}`, name: `${name} 的个人空间`, updated_at: "4" })));
    expect(after.schema).toEqual(fresh);
    await (await openProductDatabase(config)).close();
    expect(await snapshot()).toEqual(after);
    await downgrade(schema, 4);
    await (await openProductDatabase(config)).close();
    expect(await snapshot()).toEqual(after);
  });

  it.each([false, true])("upgrades V5 draft sources with row preservation, rollback and restart (seeded=%s)", async (seeded) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const config = { provider: "postgres" as const, connectionString: schema.connectionString };
    await (await openProductDatabase(config)).close();
    const fresh = (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows;
    await downgrade(schema, 5);
    if (seeded) {
      await schema.pool.query(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 2);
        INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at) VALUES ('w', 'Source', 'u', 'user', 'private', 1, 2);
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'merge_worktree', 'u', 'merge', 'pending', '{"worktreeId":"w"}', 2, 3, 1, 2);
      `);
      for (const state of ["receiving", "pending", "published", "expired", "rejected", "conflicted"]) {
        await schema.pool.query(`INSERT INTO html_view_drafts (id, author_user_id, idempotency_key, kind, space_id, name, object_key, byte_size, sha256,
          media_type, stored_etag, state, result_resource_id, expires_at, created_at, updated_at)
          VALUES ($1, 'u', $1, 'create', 's', 'Page.univer.html', $1, 3, $2, 'text/html', 'etag', $1, $3, 999, 1, 2)`,
          [state, "a".repeat(64), state === "published" ? "resource" : null]);
      }
    }
    const before = (await schema.pool.query("SELECT * FROM html_view_drafts ORDER BY id")).rows;
    const operations = (await schema.pool.query("SELECT * FROM operations ORDER BY id")).rows;
    await schema.pool.query("CREATE TABLE html_view_drafts_source_worktree (id integer)");
    const client = await schema.pool.connect();
    try {
      await client.query("UPDATE workspace_product_schema SET fingerprint = $1", [await productSchemaFingerprint(client)]);
    } finally { client.release(); }
    const failedSchema = (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows;
    await expect(openProductDatabase(config)).rejects.toThrow(/already exists/);
    expect((await schema.pool.query("SELECT * FROM workspace_product_schema")).rows).toEqual(failedSchema);
    expect((await schema.pool.query("SELECT * FROM html_view_drafts ORDER BY id")).rows).toEqual(before);
    await schema.pool.query("DROP TABLE html_view_drafts_source_worktree");
    const reset = await schema.pool.connect();
    try {
      await reset.query("UPDATE workspace_product_schema SET fingerprint = $1", [await productSchemaFingerprint(reset)]);
    } finally { reset.release(); }
    await (await openProductDatabase(config)).close();
    const after = (await schema.pool.query("SELECT * FROM html_view_drafts ORDER BY id")).rows;
    expect(after).toEqual(before.map((row) => ({ ...row, source_worktree_id: null, superseded_by: null, revises_draft_id: null })));
    expect((await schema.pool.query("SELECT * FROM operations ORDER BY id")).rows).toEqual(operations);
    expect((await schema.pool.query("SELECT * FROM workspace_product_schema")).rows).toEqual(fresh);
    if (seeded) await schema.pool.query("UPDATE html_view_drafts SET source_worktree_id = 'w' WHERE id = 'pending'");
    await (await openProductDatabase(config)).close();
    expect((await schema.pool.query("SELECT * FROM workspace_product_schema")).rows).toEqual(fresh);
    expect((await schema.pool.query("SELECT * FROM html_view_drafts ORDER BY id")).rows)
      .toEqual(after.map((row) => row.id === "pending" ? { ...row, source_worktree_id: "w" } : row));
  });

  it.each([false, true])("upgrades version 6 preserving drafts and recovery rows (seeded=%s)", async (seeded) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const config = { provider: "postgres" as const, connectionString: schema.connectionString };
    const start = async () => (await openProductDatabase(config)).close();
    await start();
    const fresh = (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows;
    await downgrade(schema, 6);
    if (seeded) {
      await schema.pool.query(`INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 2);
INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
VALUES ('op', 'merge_worktree', 'u', 'merge', 'pending', '{}', 2, 3, 1, 2);`);
      for (const state of ["receiving", "pending", "published", "rejected", "expired", "conflicted"]) {
        await schema.pool.query(`INSERT INTO html_view_drafts (id, author_user_id, idempotency_key, kind, space_id, name, object_key, byte_size, sha256,
media_type, stored_etag, state, result_resource_id, expires_at, created_at, updated_at, source_worktree_id)
VALUES ($1, 'u', $1, 'create', 's', 'Page.univer.html', $1, 3, $2, 'text/html', 'etag', $1, $3, 999, 1, 2, 'w')`,
          [state, "a".repeat(64), state === "published" ? "resource" : null]);
      }
    }
    const before = (await schema.pool.query("SELECT * FROM html_view_drafts ORDER BY id")).rows;
    const operations = (await schema.pool.query("SELECT * FROM operations ORDER BY id")).rows;
    const oldSchema = (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows;
    // A duplicate column name forces failure after the first column addition.
    await schema.pool.query("ALTER TABLE html_view_drafts ADD COLUMN revises_draft_id TEXT");
    const client = await schema.pool.connect();
    try { await client.query("UPDATE workspace_product_schema SET fingerprint = $1", [await productSchemaFingerprint(client)]); }
    finally { client.release(); }
    await expect(start()).rejects.toThrow(/already exists/);
    expect((await schema.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'html_view_drafts' AND column_name = 'superseded_by'")).rows).toEqual([]);
    await schema.pool.query("ALTER TABLE html_view_drafts DROP COLUMN revises_draft_id");
    await schema.pool.query("UPDATE workspace_product_schema SET fingerprint = $1", [oldSchema[0]!.fingerprint]);
    await start();
    const after = before.map((row) => ({ ...row, superseded_by: null, revises_draft_id: null }));
    expect((await schema.pool.query("SELECT * FROM html_view_drafts ORDER BY id")).rows).toEqual(after);
    expect((await schema.pool.query("SELECT * FROM operations ORDER BY id")).rows).toEqual(operations);
    expect((await schema.pool.query("SELECT * FROM workspace_product_schema")).rows).toEqual(fresh);
    await start();
    expect((await schema.pool.query("SELECT * FROM workspace_product_schema")).rows).toEqual(fresh);
    if (seeded) {
      await schema.pool.query("UPDATE html_view_drafts SET state = 'superseded', superseded_by = 'published' WHERE id = 'pending'");
      expect((await schema.pool.query("SELECT superseded_by FROM html_view_drafts WHERE id = 'pending'")).rows).toEqual([{ superseded_by: "published" }]);
    }
  });

  it("preserves an unrecognized occupied schema", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    await schema.pool.query("CREATE TABLE existing(id integer); INSERT INTO existing VALUES (42)");
    await expect(openProductDatabase({ provider: "postgres", connectionString: schema.connectionString })).rejects.toThrow(/empty schema/);
    expect((await schema.pool.query("SELECT * FROM existing")).rows).toEqual([{ id: 42 }]);
  });
});

/** Gives a fresh schema the structure a deployed database at an older version has. */
async function downgrade(schema: { readonly pool: Pool }, version: 1 | 2 | 3 | 4 | 5 | 6): Promise<void> {
  const client = await schema.pool.connect();
  try {
    await client.query(`ALTER TABLE html_view_drafts DROP COLUMN superseded_by, DROP COLUMN revises_draft_id;
ALTER TABLE html_view_drafts DROP CONSTRAINT html_view_drafts_state_check;
ALTER TABLE html_view_drafts ADD CONSTRAINT html_view_drafts_state_check CHECK
  (state IN ('receiving', 'pending', 'published', 'rejected', 'expired', 'conflicted'));`);
    if (version < 6) await client.query("DROP INDEX html_view_drafts_source_worktree; ALTER TABLE html_view_drafts DROP COLUMN source_worktree_id");
    if (version < 4) await client.query(`
      ALTER TABLE nodes DROP COLUMN copied_from_node_id;
      ALTER TABLE worktree_node_intents DROP COLUMN copied_from_node_id;
      ALTER TABLE node_link_sharing DROP COLUMN unverified_role, DROP COLUMN making_of_note;
      ALTER TABLE operations DROP CONSTRAINT operations_kind_check;
      ALTER TABLE operations ADD CONSTRAINT operations_kind_check CHECK (
        kind IN (
          'create_resource',
          'create_blob_resource',
          'replace_blob_content',
          'create_worktree',
          'add_worktree_unit',
          'create_worktree_unit',
          'merge_worktree',
          'discard_worktree',
          'activate_worktree_resource'
        )
      )`);
    if (version < 3) await client.query("DROP TABLE executor_access");
    await client.query("UPDATE workspace_product_schema SET version = $1, fingerprint = $2", [version, await productSchemaFingerprint(client)]);
  } finally {
    client.release();
  }
}
