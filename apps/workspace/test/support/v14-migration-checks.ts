import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DOWNGRADE_TO_V14_SQL } from "./v15-downgrade.js";

export function verifyV14Migration(
  open: (filename: string) => { connection: DatabaseSync; close(): void },
): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v14-migration-"));
  const schema = readFileSync(new URL("../../server/src/db/schema.sql", import.meta.url), "utf8");
  const createV14 = (filename: string) => {
    const database = new DatabaseSync(filename);
    database.exec(schema);
    database.exec(DOWNGRADE_TO_V14_SQL);
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 14);
    assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('space_pins', 'space_stars_user')").get(), undefined);
    return database;
  };
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const original = createV14(filename);
      if (seeded) original.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
        UPDATE users SET email = 'owner@example.com' WHERE id = 'u';
        INSERT INTO email_login_codes (id, email, code_hash, attempts, created_at, expires_at, consumed_at)
          VALUES ('active-code', 'owner@example.com', 'active-hash', 2, 1, 9999999999999, NULL),
            ('used-code', 'owner@example.com', 'used-hash', 1, 1, 9999999999999, 2);
        INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at)
          VALUES ('session', 'session-hash', 'u', 1, 9999999999999);
        INSERT INTO external_identities (provider, provider_subject, user_id, provider_username, created_at, updated_at)
          VALUES ('google', 'google-owner', 'u', 'owner', 1, 1);
        INSERT INTO spaces (id, type, name, owner_user_id, public_read, created_at, updated_at) VALUES ('s', 'team', 'Repository', 'u', 1, 1, 1);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('p', 'personal', 'Personal', 'u', 1, 1);
        UPDATE spaces SET description = 'Keep description', slug = 'repo' WHERE id = 's';
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
      const tables = original.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ).all().map((row) => ({
        name: String(row.name),
        columns: original.prepare(`PRAGMA table_info(${row.name})`).all().map((column) => column.name).join(", "),
      }));
      const rows = (database: DatabaseSync) => tables.map(({ name, columns }) =>
        database.prepare(`SELECT ${columns} FROM ${name}`).all(),
      );
      const before = rows(original);
      original.close();
      const migrated = open(filename);
      assert.deepEqual(rows(migrated.connection), before);
      assert.equal(migrated.connection.prepare("PRAGMA user_version").get()?.user_version, 18);
      assert.deepEqual(migrated.connection.prepare("SELECT * FROM space_pins").all(), []);
      assert.deepEqual(migrated.connection.prepare("PRAGMA index_info(space_stars_user)").all().map((row) => row.name), ["user_id", "created_at"]);
      if (seeded) {
        const db = migrated.connection;
        db.exec("INSERT INTO space_pins VALUES ('u', 's', 0, 7)");
        assert.throws(() => db.exec("INSERT INTO space_pins VALUES ('u', 's', 1, 7)"), /UNIQUE/);
        assert.throws(() => db.exec("INSERT INTO space_pins VALUES ('u', 'p', 0, 7)"), /UNIQUE/);
        assert.throws(() => db.exec("INSERT INTO space_pins VALUES ('u', 'missing', 1, 7)"), /FOREIGN KEY/);
        assert.throws(() => db.exec("INSERT INTO space_pins VALUES ('missing', 's', 0, 7)"), /FOREIGN KEY/);
        db.exec("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('pin-user', 'pin-user', 'Pin User', 1, 1)");
        db.exec("INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('pin-space', 'team', 'Pin', 'u', 1, 1)");
        db.exec("INSERT INTO space_pins VALUES ('pin-user', 's', 0, 7), ('u', 'pin-space', 1, 7)");
        db.exec("DELETE FROM users WHERE id = 'pin-user'; DELETE FROM spaces WHERE id = 'pin-space'");
        assert.deepEqual(db.prepare("SELECT * FROM space_pins").all().map((row) => ({ ...row })), [
          { user_id: "u", space_id: "s", position: 0, created_at: 7 },
        ]);
      }
      assert.deepEqual(migrated.connection.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(migrated.connection.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v14-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 14);
      assert.deepEqual(rows(backup), before);
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      backup.close();
      const restarted = open(filename);
      assert.equal(restarted.connection.prepare("PRAGMA user_version").get()?.user_version, 18);
      assert.deepEqual(rows(restarted.connection), before);
      assert.equal(restarted.connection.prepare("SELECT COUNT(*) AS count FROM space_pins").get()?.count, seeded ? 1 : 0);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = createV14(filename);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)");
    broken.close();
    assert.throws(() => open(filename), /V14 to V18 migration failed.*rolled back.*backup/);
    for (const name of ["rollback.sqlite", readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v14-backup-"))!]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 14);
      assert.equal(preserved.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('space_pins', 'space_stars_user')").get(), undefined);
      assert.equal(preserved.prepare("SELECT owner_user_id FROM spaces").get()?.owner_user_id, "missing");
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
    for (const damage of [
      "DROP TABLE space_pins",
      "DROP INDEX space_stars_user",
      "DROP INDEX space_stars_user; CREATE INDEX space_stars_user ON space_stars(space_id, created_at)",
      "DROP TABLE space_pins; CREATE TABLE space_pins (user_id TEXT, space_id TEXT, position INTEGER, created_at INTEGER)",
    ]) {
      const invalid = join(root, `fingerprint-${Math.random()}.sqlite`);
      const mismatched = new DatabaseSync(invalid);
      mismatched.exec(schema);
      mismatched.exec(damage);
      mismatched.close();
      assert.throws(() => open(invalid), /V15 fingerprint mismatch/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
