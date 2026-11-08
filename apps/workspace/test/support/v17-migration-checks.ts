import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DOWNGRADE_TO_V17_SQL, DROP_V18_SQL } from "./v18-downgrade.js";

const NEW_TABLES = ["oauth_clients", "oauth_grants", "oauth_refresh_history", "personal_access_tokens"];
const SESSION_COLUMNS = ["id", "secret_hash", "user_id", "created_at", "expires_at", "write_source"];

export function verifyV17Migration(
  open: (filename: string) => { connection: DatabaseSync; close(): void },
): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v17-migration-"));
  const schema = readFileSync(new URL("../../server/src/db/schema.sql", import.meta.url), "utf8");
  const tableNames = (database: DatabaseSync) =>
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map((row) => String(row.name));
  const sessionColumns = (database: DatabaseSync) =>
    database.prepare("PRAGMA table_info(login_sessions)").all().map((column) => String(column.name));
  const createV17 = (filename: string) => {
    const database = new DatabaseSync(filename);
    database.exec(schema);
    database.exec(DOWNGRADE_TO_V17_SQL);
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 17);
    assert.deepEqual(sessionColumns(database), SESSION_COLUMNS);
    for (const table of NEW_TABLES) assert.ok(!tableNames(database).includes(table));
    return database;
  };
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const original = createV17(filename);
      if (seeded) original.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('v', 'viewer', 'Viewer', 1, 1);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('p', 'personal', 'Personal', 'u', 1, 1);
        INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, write_source) VALUES ('live-browser', 'h1', 'u', 10, 9999999999999, 'browser');
        INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, write_source) VALUES ('live-agent', 'h2', 'u', 11, 9999999999998, 'agent');
        INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, write_source) VALUES ('live-unknown', 'h3', 'v', 12, 9999999999997, NULL);
        INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, write_source) VALUES ('expired', 'h4', 'v', 1, 2, 'browser');
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_resource', 'u', 'reserve', 'pending', '{"unitType":"doc"}', 2, 3, 1, 2);
      `);
      const tables = tableNames(original).map((name) => ({
        name,
        columns: original.prepare(`PRAGMA table_info(${name})`).all().map((column) => column.name).join(", "),
      }));
      const rows = (database: DatabaseSync) => tables.map(({ name, columns }) =>
        database.prepare(`SELECT ${columns} FROM ${name}`).all(),
      );
      const before = rows(original);
      original.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.deepEqual(rows(db), before);
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 18);
      assert.deepEqual(sessionColumns(db), [...SESSION_COLUMNS, "issued_for_pat_id", "issued_for_grant_id"]);
      for (const table of NEW_TABLES) {
        assert.ok(tableNames(db).includes(table));
        assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
      }
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM login_sessions WHERE issued_for_pat_id IS NOT NULL OR issued_for_grant_id IS NOT NULL").get()?.count,
        0,
      );
      if (seeded) {
        db.exec(`
          INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at) VALUES ('pat', 'u', 'Laptop', 'pat-hash', 'read write', 5);
          INSERT INTO oauth_grants (id, user_id, client_id, scopes, resource, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at, created_at)
            VALUES ('grant', 'u', 'client', 'read', 'https://mcp.example/mcp', 'at-hash', 9, 'rt-hash', 99, 5);
          INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, issued_for_pat_id) VALUES ('for-pat', 'h5', 'u', 6, 7, 'pat');
          INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, issued_for_grant_id) VALUES ('for-grant', 'h6', 'u', 6, 7, 'grant');
        `);
        assert.throws(() => db.exec("INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, issued_for_pat_id, issued_for_grant_id) VALUES ('both', 'h', 'u', 1, 2, 'pat', 'grant')"), /CHECK/);
        assert.throws(() => db.exec("INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, issued_for_pat_id) VALUES ('ghost', 'h', 'u', 1, 2, 'missing')"), /FOREIGN KEY/);
        assert.throws(() => db.exec("INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at) VALUES ('dup', 'u', 'Again', 'pat-hash', 'read', 5)"), /UNIQUE/);
        assert.throws(() => db.exec("INSERT INTO oauth_grants (id, user_id, client_id, scopes, resource, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at, created_at) VALUES ('dup', 'u', 'c', 'read', 'r', 'at-hash', 1, 'other', 1, 1)"), /UNIQUE/);
        assert.throws(() => db.exec("INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at) VALUES ('orphan', 'missing', 'N', 'h', 'read', 5)"), /FOREIGN KEY/);
        db.exec("INSERT INTO oauth_refresh_history (refresh_token_hash, grant_id, retired_at) VALUES ('old-rt', 'grant', 5)");
        assert.throws(() => db.exec("INSERT INTO oauth_refresh_history (refresh_token_hash, grant_id, retired_at) VALUES ('old-rt', 'grant', 6)"), /UNIQUE|PRIMARY/);
        assert.throws(() => db.exec("INSERT INTO oauth_refresh_history (refresh_token_hash, grant_id, retired_at) VALUES ('ghost-rt', 'missing', 6)"), /FOREIGN KEY/);
        db.exec("DELETE FROM personal_access_tokens WHERE id = 'pat'");
        assert.deepEqual(db.prepare("SELECT id FROM login_sessions WHERE id LIKE 'for-%'").all().map((row) => row.id), ["for-grant"]);
        db.exec(`
          INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('w', 'leaver', 'Leaver', 1, 1);
          INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at) VALUES ('pat-w', 'w', 'Phone', 'pat-w-hash', 'read', 5);
          INSERT INTO oauth_grants (id, user_id, client_id, scopes, resource, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at, created_at)
            VALUES ('grant-w', 'w', 'client', 'read', 'https://mcp.example/mcp', 'at-w', 9, 'rt-w', 99, 5);
          INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, issued_for_pat_id) VALUES ('w-pat', 'h7', 'w', 6, 7, 'pat-w');
        `);
        db.exec("INSERT INTO oauth_refresh_history (refresh_token_hash, grant_id, retired_at) VALUES ('old-w', 'grant-w', 5)");
        db.exec("DELETE FROM users WHERE id = 'w'");
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM oauth_refresh_history WHERE grant_id = 'grant-w'").get()?.count, 0);
        for (const table of ["personal_access_tokens", "login_sessions"]) {
          assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = 'w'`).get()?.count, 0);
        }
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM oauth_grants WHERE user_id = 'w'").get()?.count, 0);
      }
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v17-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 17);
      assert.deepEqual(rows(backup), before);
      assert.deepEqual(sessionColumns(backup), SESSION_COLUMNS);
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      backup.close();
      const restarted = open(filename);
      assert.equal(restarted.connection.prepare("PRAGMA user_version").get()?.user_version, 18);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = createV17(filename);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)");
    broken.close();
    assert.throws(() => open(filename), /V17 to V18 migration failed.*rolled back.*backup/);
    for (const name of ["rollback.sqlite", readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v17-backup-"))!]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 17);
      assert.deepEqual(sessionColumns(preserved), SESSION_COLUMNS);
      for (const table of NEW_TABLES) assert.ok(!tableNames(preserved).includes(table));
      assert.equal(preserved.prepare("SELECT owner_user_id FROM spaces").get()?.owner_user_id, "missing");
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
    for (const damage of [DROP_V18_SQL, "DROP INDEX login_sessions_grant", "DROP INDEX oauth_refresh_history_grant"]) {
      const invalid = join(root, `fingerprint-${Math.random()}.sqlite`);
      const mismatched = new DatabaseSync(invalid);
      mismatched.exec(schema);
      mismatched.exec(damage);
      mismatched.close();
      assert.throws(() => open(invalid), /V18 fingerprint mismatch/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
