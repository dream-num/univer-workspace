import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V35_SQL } from "./v35-downgrade.js";

export function verifyV34Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v34-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V35_SQL);
    db.exec("PRAGMA user_version = 34");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at, landing) VALUES ('t', 'team', 'Team', 'team', 'u', 1, 2, 'checks');
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, result_json, attempt_count, next_attempt_at, lease_owner, lease_expires_at, created_at, updated_at, completed_at)
          VALUES ('revert-1', 'revert_worktrees', 'u', 'reserved', 'completed', '{"worktreeIds":["w"]}', '{"state":"done"}', 1, 3, NULL, NULL, 3, 4, 4),
                 ('copy-1', 'copy_node', 'u', 'objects_copied', 'pending', '{"sourceNodeId":"n"}', NULL, 2, 5, 'worker', 6, 5, 6, NULL);
        INSERT INTO blob_upload_sessions (id, operation_id, actor_user_id, target_space_id, node_id, resource_id, object_key, node_name, original_filename, byte_size, state, expires_at, created_at, updated_at)
          VALUES ('up', 'copy-1', 'u', 't', 'node-up', 'res-up', 'key-up', 'a.txt', 'a.txt', 1, 'waiting_for_upload', 9, 5, 6);
      `);
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('source_rate_events', 'sign_in_codes') ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  const hasEvents = (db: DatabaseSync) => db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'source_rate_events'").get() !== undefined;
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = snapshot(old);
      assert.equal(hasEvents(old), false);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.equal(version(db), 36);
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(db.prepare("SELECT * FROM source_rate_events").all(), []);
      assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'source_rate_events' AND sql IS NOT NULL ORDER BY name").all().map(({ name }) => name),
        ["source_rate_events_expiry", "source_rate_events_source"]);
      db.exec("INSERT INTO source_rate_events (id, action, source, created_at) VALUES ('e1', 'agent_create', '203.0.113.7', 10)");
      assert.throws(() => db.exec("INSERT INTO source_rate_events (id, action, source, created_at) VALUES ('e1', 'agent_create', '203.0.113.7', 11)"), /UNIQUE/);
      assert.throws(() => db.exec("INSERT INTO source_rate_events (id, action, source) VALUES ('e2', 'agent_create', '203.0.113.7')"), /NOT NULL/);
      db.exec("DELETE FROM source_rate_events");
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v34-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 34);
      assert.deepEqual(snapshot(backup), before);
      assert.equal(hasEvents(backup), false);
      backup.close();
      const restarted = open(filename);
      assert.deepEqual(snapshot(restarted.connection), before);
      assert.equal(version(restarted.connection), 36);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 2)");
    const before = snapshot(broken);
    broken.close();
    assert.throws(() => open(filename), /V34 to V36 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v34-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 34);
      assert.deepEqual(snapshot(db), before);
      assert.equal(hasEvents(db), false);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
