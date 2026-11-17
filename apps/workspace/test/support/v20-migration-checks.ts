import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";

// V21 adds users.kind; compare the columns Users already had.
const USER_COLUMNS = "id, username, display_name, avatar_url, created_at, updated_at, email";

export function verifyV20Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v20-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec("DROP TABLE executor_access; DROP TABLE node_reports; DROP TABLE agents; ALTER TABLE users DROP COLUMN kind; PRAGMA user_version = 20");
    if (seeded)
      db.exec(`
      INSERT INTO users (id, username, display_name, created_at, updated_at, email) VALUES ('u', 'owner', 'Owner', 1, 1, 'owner@example.com');
      INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('v', 'viewer', 'Viewer', 1, 1);
      INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, write_source) VALUES ('session', 'hash', 'u', 1, 999, 'agent');
      INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);
      INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 's', 'Page.univer.html', 'u', 1, 1);
      INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES ('r', 'n', 'blob', 1, 1);
      INSERT INTO blob_resources (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
        VALUES ('r', 'published-object', 'Page.univer.html', 'text/plain', 3, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'etag', 'ready', 1, 1);
      INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES ('op', 'create_resource', 'u', 'reserve', 'pending', '{}', 2, 3, 1, 2);
      INSERT INTO object_deletion_jobs (id, object_key, reason, next_attempt_at, created_at, updated_at)
        VALUES ('job', 'abandoned-object', 'blob_upload_abandoned', 3, 1, 2);
      INSERT INTO blob_upload_sessions (id, operation_id, actor_user_id, target_space_id, node_id, resource_id, object_key, node_name, original_filename, byte_size, state, expires_at, created_at, updated_at)
        VALUES ('upload', 'op', 'u', 's', 'reserved-node', 'reserved-resource', 'reserved-object', 'File', 'File', 3, 'waiting_for_upload', 999, 1, 1);
      INSERT INTO skill_drafts (id, author_user_id, idempotency_key, intent_sha256, space_id, name, files, keep, scan, review, unverified_review_count, state, expires_at, created_at, updated_at)
        VALUES ('skill', 'u', 'skill-key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 's', 'weekly-report', '[]', '[]', '[]', '[]', 0, 'pending', 999, 1, 1);
    `);
    return db;
  };
  const rows = (db: DatabaseSync) =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('agents', 'node_reports', 'executor_access') ORDER BY name",
      )
      .all()
      .map(({ name }) => [name, db.prepare(`SELECT ${name === "users" ? USER_COLUMNS : "*"} FROM ${name}`).all()]);
  const userColumns = (db: DatabaseSync) =>
    db.prepare("PRAGMA table_info(users)").all().map(({ name }) => name);
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      assert.equal(userColumns(old).includes("kind"), false);
      const before = rows(old);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.deepEqual(rows(db), before);
      assert.deepEqual(
        db.prepare("SELECT DISTINCT kind FROM users").all().map((row) => row.kind),
        seeded ? ["human"] : [],
      );
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 23);
      assert.equal(userColumns(db).at(-1), "kind");
      assert.equal(db.prepare("SELECT count(*) AS n FROM agents").get()?.n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM node_reports").get()?.n, 0);
      if (seeded) {
        assert.throws(() => db.exec("UPDATE users SET kind = 'robot' WHERE id = 'v'"), /CHECK/);
        db.exec(`
          INSERT INTO users (id, username, display_name, created_at, updated_at, kind) VALUES ('a', 'agent-x1y2', 'agent', 1, 1, 'agent');
          INSERT INTO agents (user_id, origin_label, created_at, last_active_at, expires_at) VALUES ('a', 'agent', 1, 1, 2);
        `);
        assert.throws(() => db.exec("UPDATE agents SET owner_user_id = 'v' WHERE user_id = 'a'"), /CHECK/);
        assert.throws(() => db.exec("UPDATE agents SET owner_user_id = 'missing', claimed_at = 2 WHERE user_id = 'a'"), /FOREIGN KEY/);
        db.exec("UPDATE agents SET owner_user_id = 'v', claimed_at = 2, expires_at = NULL WHERE user_id = 'a'");
        assert.throws(() => db.exec("DELETE FROM users WHERE id = 'v'"), /FOREIGN KEY/);
        db.exec(`
          INSERT INTO node_reports (id, node_id, reporter_user_id, reason, created_at) VALUES ('anonymous', 'n', NULL, 'spam', 1);
          INSERT INTO node_reports (id, node_id, reporter_user_id, reason, created_at) VALUES ('signed-in', 'n', 'a', 'spam', 1);
        `);
        assert.throws(() => db.exec("INSERT INTO node_reports (id, node_id, reason, created_at) VALUES ('orphan', 'missing', 'spam', 1)"), /FOREIGN KEY/);
        db.exec("DELETE FROM users WHERE id = 'a'");
        assert.equal(db.prepare("SELECT count(*) AS n FROM agents").get()?.n, 0);
        assert.deepEqual(
          db.prepare("SELECT id, reporter_user_id FROM node_reports ORDER BY id").all().map((row) => ({ ...row })),
          [{ id: "anonymous", reporter_user_id: null }, { id: "signed-in", reporter_user_id: null }],
        );
        db.exec("DELETE FROM node_reports");
      }
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      migrated.close();
      const backups = () =>
        readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v20-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 20);
      assert.deepEqual(rows(backup), before);
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      backup.close();
      const restarted = open(filename);
      assert.deepEqual(rows(restarted.connection), before);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, false);
    broken.exec(
      "PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)",
    );
    broken.close();
    assert.throws(() => open(filename), /V20 to V23 migration failed.*rolled back.*backup/);
    for (const name of [
      "rollback.sqlite",
      readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v20-backup-"))!,
    ]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 20);
      assert.deepEqual(
        preserved.prepare("SELECT name FROM sqlite_master WHERE name IN ('agents', 'node_reports')").all(),
        [],
      );
      assert.equal(userColumns(preserved).includes("kind"), false);
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
