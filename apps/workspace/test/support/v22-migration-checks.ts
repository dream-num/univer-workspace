import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V24_SQL, withoutV24Columns } from "./v24-downgrade.js";

export function verifyV22Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v22-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V24_SQL);
    db.exec("DROP TABLE executor_access; PRAGMA user_version = 22");
    if (seeded)
      db.exec(`
      INSERT INTO users (id, username, display_name, created_at, updated_at, email) VALUES ('u', 'owner', 'Owner', 1, 1, 'owner@example.com');
      INSERT INTO users (id, username, display_name, created_at, updated_at, kind) VALUES ('a', 'agent-x1y2', 'agent', 1, 1, 'agent');
      INSERT INTO agents (user_id, origin_label, created_at, last_active_at, expires_at) VALUES ('a', 'agent', 1, 1, 2);
      INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, write_source) VALUES ('session', 'hash', 'u', 1, 999, 'agent');
      INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);
      INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 's', 'Budget', 'u', 1, 1);
      INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES ('op', 'create_resource', 'u', 'reserve', 'pending', '{}', 2, 3, 1, 2);
      INSERT INTO object_deletion_jobs (id, object_key, reason, next_attempt_at, created_at, updated_at)
        VALUES ('job', 'abandoned-object', 'blob_upload_abandoned', 3, 1, 2);
      INSERT INTO blob_upload_sessions (id, operation_id, actor_user_id, target_space_id, node_id, resource_id, object_key, node_name, original_filename, byte_size, state, expires_at, created_at, updated_at)
        VALUES ('upload', 'op', 'u', 's', 'reserved-node', 'reserved-resource', 'reserved-object', 'File', 'File', 3, 'waiting_for_upload', 999, 1, 1);
    `);
    return db;
  };
  const rows = (db: DatabaseSync) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('executor_access', 'forks', 'issue_verdicts') ORDER BY name")
      .all()
      .map(({ name }) => [name, withoutV24Columns(String(name), db.prepare(`SELECT * FROM ${name}`).all())]);
  const hasTable = (db: DatabaseSync) =>
    db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'executor_access'").get() !== undefined;
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      assert.equal(hasTable(old), false);
      const before = rows(old);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.deepEqual(rows(db), before);
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 31);
      assert.equal(db.prepare("SELECT count(*) AS n FROM executor_access").get()?.n, 0);
      if (seeded) {
        db.exec(`
          INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('gone', 'gone', 'Gone', 1, 1);
          INSERT INTO executor_access (user_id, granted_at) VALUES ('u', 5), ('a', 6), ('gone', 7);
        `);
        assert.throws(() => db.exec("INSERT INTO executor_access (user_id, granted_at) VALUES ('u', 8)"), /UNIQUE/);
        assert.throws(() => db.exec("INSERT INTO executor_access (user_id, granted_at) VALUES ('missing', 8)"), /FOREIGN KEY/);
        assert.throws(() => db.exec("INSERT INTO executor_access (user_id) VALUES ('u')"), /NOT NULL/);
        db.exec("DELETE FROM users WHERE id = 'gone'");
        assert.deepEqual(
          db.prepare("SELECT user_id, granted_at FROM executor_access ORDER BY user_id").all().map((row) => ({ ...row })),
          [{ user_id: "a", granted_at: 6 }, { user_id: "u", granted_at: 5 }],
        );
        db.exec("DELETE FROM executor_access");
      }
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      migrated.close();
      const backups = () =>
        readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v22-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 22);
      assert.equal(hasTable(backup), false);
      assert.deepEqual(rows(backup), before);
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      backup.close();
      const restarted = open(filename);
      assert.deepEqual(rows(restarted.connection), before);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec(
      "PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)",
    );
    const before = rows(broken);
    broken.close();
    assert.throws(() => open(filename), /V22 to V31 migration failed.*rolled back.*backup/);
    for (const name of [
      "rollback.sqlite",
      readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v22-backup-"))!,
    ]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 22);
      assert.equal(hasTable(preserved), false);
      assert.deepEqual(rows(preserved), before);
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
