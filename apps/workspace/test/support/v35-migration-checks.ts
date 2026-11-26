import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V36_SQL } from "./v36-downgrade.js";

export function verifyV35Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v35-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V36_SQL);
    db.exec("PRAGMA user_version = 35");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at, landing) VALUES ('t', 'team', 'Team', 'team', 'u', 1, 2, 'checks');
        INSERT INTO login_sessions (id, user_id, secret_hash, created_at, expires_at) VALUES ('s', 'u', 'hash', 3, 9);
        INSERT INTO source_rate_events (id, action, source, created_at) VALUES ('e1', 'agent_create', '203.0.113.7', 10);
      `);
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'sign_in_codes' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  const hasCodes = (db: DatabaseSync) => db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sign_in_codes'").get() !== undefined;
  const insert = (db: DatabaseSync, values: string) => db.exec(`INSERT INTO sign_in_codes (kind, code_hash, user_code_hash, payload_json, created_at, expires_at) VALUES ${values}`);
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = snapshot(old);
      assert.equal(hasCodes(old), false);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.equal(version(db), 36);
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(db.prepare("SELECT * FROM sign_in_codes").all(), []);
      assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sign_in_codes' AND sql IS NOT NULL ORDER BY name").all().map(({ name }) => name),
        ["sign_in_codes_expiry", "sign_in_codes_subject"]);
      insert(db, "('cli', 'device-1', 'user-1', '{}', 10, 20)");
      assert.deepEqual({ ...db.prepare("SELECT state, subject_user_id, grant_id FROM sign_in_codes").get() }, { state: "pending", subject_user_id: null, grant_id: null });
      assert.throws(() => insert(db, "('cli', 'device-1', 'user-2', '{}', 10, 20)"), /UNIQUE/);
      assert.throws(() => insert(db, "('cli', 'device-2', 'user-1', '{}', 10, 20)"), /UNIQUE/);
      insert(db, "('claim', 'device-1', NULL, '{}', 10, 20), ('claim', 'claim-2', NULL, '{}', 10, 20)");
      assert.throws(() => insert(db, "('password', 'p', NULL, '{}', 10, 20)"), /CHECK/);
      assert.throws(() => db.exec("UPDATE sign_in_codes SET state = 'used'"), /CHECK/);
      assert.throws(() => db.exec("INSERT INTO sign_in_codes (kind, code_hash, payload_json, created_at) VALUES ('claim', 'c', '{}', 10)"), /NOT NULL/);
      db.exec("DELETE FROM sign_in_codes");
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v35-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 35);
      assert.deepEqual(snapshot(backup), before);
      assert.equal(hasCodes(backup), false);
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
    assert.throws(() => open(filename), /V35 to V36 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v35-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 35);
      assert.deepEqual(snapshot(db), before);
      assert.equal(hasCodes(db), false);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
