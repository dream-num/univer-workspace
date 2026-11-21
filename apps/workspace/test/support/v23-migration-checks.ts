import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V24_SQL, withoutV24Columns } from "./v24-downgrade.js";

const SHA = "a".repeat(64);

export function verifyV23Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v23-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V24_SQL);
    db.exec("PRAGMA user_version = 23");
    if (seeded)
      db.exec(`
      INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
      INSERT INTO executor_access (user_id, granted_at) VALUES ('u', 5);
      INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);
      INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 's', 'Budget', 'u', 1, 1);
      INSERT INTO nodes (id, space_id, parent_id, name, created_by, created_at, updated_at) VALUES ('child', 's', 'n', 'Notes.txt', 'u', 1, 1);
      INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES ('r', 'child', 'blob', 1, 1);
      INSERT INTO blob_resources (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
        VALUES ('r', 'published-object', 'Notes.txt', 'text/plain', 3, '${SHA}', 'etag', 'ready', 1, 1);
      INSERT INTO node_link_sharing (node_id, enabled, role, created_by, updated_by, created_at, updated_at) VALUES ('n', 1, 'editor', 'u', 'u', 1, 1);
      INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at) VALUES ('w', 'Draft', 'u', 'user', 'private', 1, 1);
      INSERT INTO worktree_units (worktree_id, unit_id, resource_id, source, ordinal, added_at) VALUES ('w', 'unit', 'draft-resource', 'worktree', 0, 1);
      INSERT INTO worktree_node_intents (worktree_id, unit_id, node_id, target_space_id, name, unit_type, created_by, created_at, updated_at)
        VALUES ('w', 'unit', 'draft-node', 's', 'Draft sheet', 'sheet', 'u', 1, 1);
      INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, lease_owner, lease_expires_at, created_at, updated_at)
        VALUES ('pending', 'create_blob_resource', 'u', 'reserved', 'pending', '{"a":1}', 2, 3, 'product-api', 9, 1, 2);
      INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, result_json, attempt_count, next_attempt_at, created_at, updated_at, completed_at)
        VALUES ('done', 'create_resource', 'u', 'completed', 'completed', '{}', '{"nodeId":"n"}', 1, 1, 1, 2, 2);
      INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, last_error_code, last_error_message, created_at, updated_at)
        VALUES ('failed', 'merge_worktree', 'u', 'merge', 'failed', '{}', 3, 1, 'CONFLICT', 'stale', 1, 2);
      INSERT INTO blob_upload_sessions (id, operation_id, actor_user_id, target_space_id, node_id, resource_id, object_key, node_name, original_filename, byte_size, state, expires_at, created_at, updated_at)
        VALUES ('upload', 'pending', 'u', 's', 'reserved-node', 'reserved-resource', 'reserved-object', 'File', 'File', 3, 'waiting_for_upload', 999, 1, 1);
      INSERT INTO object_deletion_jobs (id, object_key, reason, next_attempt_at, created_at, updated_at)
        VALUES ('job', 'abandoned-object', 'blob_upload_abandoned', 3, 1, 2);
    `);
    return db;
  };
  const rows = (db: DatabaseSync) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(({ name }) => [name, withoutV24Columns(String(name), db.prepare(`SELECT * FROM ${name}`).all())]);
  const columns = (db: DatabaseSync, table: string) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name);
  const leftovers = (db: DatabaseSync) =>
    db.prepare("SELECT name FROM sqlite_master WHERE name IN ('operations_v24', 'nodes_copied_from')").all();
  const operationsSql = (db: DatabaseSync) =>
    String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'operations'").get()?.sql);
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      assert.equal(columns(old, "nodes").includes("copied_from_node_id"), false);
      assert.equal(operationsSql(old).includes("copy_node"), false);
      const before = rows(old);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.deepEqual(rows(db), before);
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 26);
      assert.equal(columns(db, "nodes").at(-1), "copied_from_node_id");
      assert.equal(columns(db, "worktree_node_intents").at(-1), "copied_from_node_id");
      assert.deepEqual(columns(db, "node_link_sharing").slice(-2), ["unverified_role", "making_of_note"]);
      assert.deepEqual(
        db.prepare("SELECT name FROM sqlite_master WHERE name IN ('operations_v24', 'operations_due', 'operations_actor', 'nodes_copied_from') ORDER BY name").all().map((row) => row.name),
        ["nodes_copied_from", "operations_actor", "operations_due"],
      );
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      migrated.close();
      const backups = () =>
        readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v23-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 23);
      assert.deepEqual(rows(backup), before);
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      backup.close();
      const restarted = open(filename);
      const live = restarted.connection;
      assert.deepEqual(rows(live), before);
      assert.equal(backups().length, 1);
      if (seeded) {
        assert.throws(() => live.exec("UPDATE node_link_sharing SET unverified_role = 'owner' WHERE node_id = 'n'"), /CHECK/);
        live.exec("UPDATE node_link_sharing SET unverified_role = 'editor', making_of_note = 'Built from the Q3 export.' WHERE node_id = 'n'");
        const insertOperation = (id: string, kind: string) =>
          live.prepare("INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, next_attempt_at, created_at, updated_at) VALUES (?, ?, 'u', 'reserved', 'pending', '{}', 1, 1, 1)").run(id, kind);
        insertOperation("copy", "copy_node");
        assert.throws(() => insertOperation("bogus", "move_node"), /CHECK/);
        // The rebuilt table still owns the inbound upload-session reference.
        assert.throws(() => live.exec("DELETE FROM operations WHERE id = 'pending'; INSERT INTO blob_upload_sessions (id, operation_id, actor_user_id, target_space_id, node_id, resource_id, object_key, node_name, original_filename, byte_size, state, expires_at, created_at, updated_at) VALUES ('orphan', 'pending', 'u', 's', 'n2', 'r2', 'o2', 'File', 'File', 3, 'waiting_for_upload', 999, 1, 1)"), /FOREIGN KEY/);
        assert.equal(live.prepare("SELECT count(*) AS n FROM blob_upload_sessions").get()?.n, 0);
        const insertCopy = (id: string, source: string) =>
          live.prepare("INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at, copied_from_node_id) VALUES (?, 's', ?, 'u', 1, 1, ?)").run(id, id, source);
        assert.throws(() => insertCopy("orphan-copy", "missing"), /FOREIGN KEY/);
        live.exec("INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('source', 's', 'Source', 'u', 1, 1)");
        insertCopy("copy", "source");
        live.exec("DELETE FROM nodes WHERE id = 'source'");
        assert.equal(live.prepare("SELECT copied_from_node_id FROM nodes WHERE id = 'copy'").get()?.copied_from_node_id, null);
      }
      assert.deepEqual(live.prepare("PRAGMA foreign_key_check").all(), []);
      restarted.close();
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec(
      "PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)",
    );
    const before = rows(broken);
    broken.close();
    assert.throws(() => open(filename), /V23 to V26 migration failed.*rolled back.*backup/);
    for (const name of [
      "rollback.sqlite",
      readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v23-backup-"))!,
    ]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 23);
      assert.deepEqual(leftovers(preserved), []);
      assert.equal(columns(preserved, "nodes").includes("copied_from_node_id"), false);
      assert.equal(operationsSql(preserved).includes("copy_node"), false);
      assert.deepEqual(rows(preserved), before);
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
