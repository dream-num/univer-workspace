import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateV8ToV9 } from "../../server/src/db/migrations/v8-to-v9/migrate.js";
import { migrateV9ToV10 } from "../../server/src/db/migrations/v9-to-v10/migrate.js";
import { migrateV10ToV11 } from "../../server/src/db/migrations/v10-to-v11/migrate.js";
import { withoutSpaceDescription } from "./space-description.js";

/** Run unchanged against source and built startup, preserving every pre-existing table. */
export function verifyV11Migration(
  open: (filename: string) => { connection: DatabaseSync; close(): void },
): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v11-migration-"));
  const createV11 = (filename: string) => {
    const database = new DatabaseSync(filename);
    database.exec(readFileSync(new URL("../fixtures/schema-v8.sql", import.meta.url), "utf8"));
    migrateV8ToV9(database);
    migrateV9ToV10(database);
    migrateV10ToV11(database);
    return database;
  };
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const original = createV11(filename);
      if (seeded)
        original.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
        INSERT INTO spaces (id, type, name, owner_user_id, public_read, created_at, updated_at) VALUES ('s', 'team', 'Repository', 'u', 1, 1, 1);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('p', 'personal', 'Personal', 'u', 1, 1);
        INSERT INTO space_stars (space_id, user_id, created_at) VALUES ('s', 'u', 5);
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at) VALUES ('w', 'Draft', 'u', 'team', 's', 'space', 1, 1);
        INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 's', 'Published', 'u', 1, 1);
        INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES ('r', 'n', 'blob', 1, 1);
        INSERT INTO blob_resources (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
          VALUES ('r', 'existing-object', 'file.txt', 'text/plain', 4, '${"a".repeat(64)}', 'old-etag', 'ready', 1, 1);
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_blob_resource', 'u', 'awaiting_upload', 'pending', '{"objectKey":"pending-object"}', 2, 3, 1, 2);
        INSERT INTO blob_upload_sessions (id, operation_id, actor_user_id, target_space_id, node_id, resource_id, object_key, node_name, original_filename, byte_size, state, expires_at, created_at, updated_at)
          VALUES ('upload', 'op', 'u', 's', 'reserved-node', 'reserved-resource', 'pending-object', 'Pending', 'pending.bin', 9, 'verifying', 9999999999999, 1, 2);
        INSERT INTO object_deletion_jobs (id, object_key, reason, attempt_count, next_attempt_at, lease_owner, lease_expires_at, created_at, updated_at)
          VALUES ('job', 'abandoned-object', 'blob_upload_abandoned', 3, 99, 'worker', 999, 1, 2);
        INSERT INTO issues (id, space_id, number, title, state, author_user_id, created_at, updated_at) VALUES ('issue', 's', 1, 'Keep me', 'open', 'u', 1, 2);
      `);
      const tables = original
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => String(row.name));
      const rows = (database: DatabaseSync) =>
        tables.map((table) =>
          withoutSpaceDescription(table, database.prepare(`SELECT * FROM ${table}`).all()),
        );
      const before = rows(original);
      original.close();
      const migrated = open(filename);
      assert.deepEqual(rows(migrated.connection), before);
      assert.equal(migrated.connection.prepare("PRAGMA user_version").get()?.user_version, 12);
      // V12 adds NULL slug/number only; nothing is backfilled.
      assert.deepEqual(
        migrated.connection.prepare("SELECT slug FROM spaces").all().map((row) => row.slug),
        seeded ? [null, null] : [],
      );
      assert.deepEqual(
        migrated.connection.prepare("SELECT number FROM worktrees").all().map((row) => row.number),
        seeded ? [null] : [],
      );
      if (seeded) {
        const db = migrated.connection;
        const set = (sql: string) => db.exec(sql);
        set("UPDATE spaces SET slug = 'Repo' WHERE id = 's'");
        // slugs are unique per owner without regard to case, and only team spaces may have one
        assert.throws(() => set("INSERT INTO spaces (id, type, name, owner_user_id, slug, created_at, updated_at) VALUES ('t', 'team', 'Other', 'u', 'REPO', 1, 1)"), /UNIQUE/);
        assert.throws(() => set("UPDATE spaces SET slug = 'x' WHERE id = 'p'"), /only a team space/);
        assert.throws(() => set("UPDATE spaces SET slug = 'Personal' WHERE id = 's'"), /personal is reserved/);
        assert.throws(() => set("INSERT INTO spaces (id, type, name, owner_user_id, slug, created_at, updated_at) VALUES ('t', 'team', 'Other', 'u', 'PERSONAL', 1, 1)"), /personal is reserved/);
        // numbers are unique per team space (and per creator for user worktrees)
        set("UPDATE worktrees SET number = 1 WHERE id = 'w'");
        assert.throws(() => set("INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, number, created_at, updated_at) VALUES ('w2', 'Dup', 'u', 'team', 's', 'space', 1, 1, 1)"), /UNIQUE/);
        set("INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, number, created_at, updated_at) VALUES ('w3', 'Mine', 'u', 'user', 'private', 1, 1, 1)");
        assert.throws(() => set("INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, number, created_at, updated_at) VALUES ('w4', 'Dup', 'u', 'user', 'private', 1, 1, 1)"), /UNIQUE/);
        set("DELETE FROM worktrees WHERE id IN ('w3'); UPDATE worktrees SET number = NULL; UPDATE spaces SET slug = NULL");
      }
      assert.deepEqual(migrated.connection.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(
        migrated.connection.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
      migrated.close();
      const backups = () =>
        readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v11-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 11);
      assert.deepEqual(rows(backup), before);
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      backup.close();
      const restarted = open(filename);
      assert.equal(restarted.connection.prepare("PRAGMA user_version").get()?.user_version, 12);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    // Fail the post-DDL validation to prove the new column and version roll back.
    const filename = join(root, "rollback.sqlite");
    const broken = createV11(filename);
    broken.exec(
      "PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)",
    );
    broken.close();
    assert.throws(() => open(filename), /V11 to V12 migration failed.*rolled back.*backup/);
    for (const name of [
      "rollback.sqlite",
      readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v11-backup-"))!,
    ]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 11);
      assert.deepEqual(
        preserved
          .prepare("PRAGMA table_info(spaces)")
          .all()
          .filter((column) => column.name === "slug"),
        [],
      );
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
