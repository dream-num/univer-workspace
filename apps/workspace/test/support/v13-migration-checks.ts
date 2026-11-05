import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DOWNGRADE_TO_V13_SQL } from "./v13-downgrade.js";

/**
 * Run unchanged against source and built startup, preserving every V13 row and
 * proving the additive Email identity migration rolls back as a unit.
 */
export function verifyV13Migration(
  open: (filename: string) => { connection: DatabaseSync; close(): void },
): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v13-migration-"));
  const schema = readFileSync(
    new URL("../../server/src/db/schema.sql", import.meta.url),
    "utf8",
  );
  const createV13 = (filename: string) => {
    const database = new DatabaseSync(filename);
    database.exec(schema);
    database.exec(DOWNGRADE_TO_V13_SQL);
    assert.equal(
      database.prepare("PRAGMA user_version").get()?.user_version,
      13,
    );
    return database;
  };
  const seededData = `
    INSERT INTO users (id, username, display_name, created_at, updated_at)
      VALUES ('u', 'owner', 'Owner', 1, 1);
    INSERT INTO users (id, username, display_name, created_at, updated_at)
      VALUES ('u2', 'teammate', 'Teammate', 1, 1);
    INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at)
      VALUES ('u', 'scrypt$salt$key', 1, 1);
    INSERT INTO external_identities
      (provider, provider_subject, user_id, provider_username, created_at, updated_at)
      VALUES ('github', 'gh-1', 'u', 'octocat', 1, 1);
    INSERT INTO external_identities
      (provider, provider_subject, user_id, provider_username, created_at, updated_at)
      VALUES ('google', 'g-1', 'u2', 'alice', 1, 1);
    INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at)
      VALUES ('p', 'personal', 'Personal', 'u', 1, 1);
    INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at)
      VALUES ('s', 'hash', 'u', 1, 9999999999999);
  `;
  const v14Tables = ["email_login_codes", "user_emails"] as const;
  try {
    const filename = join(root, "case.sqlite");
    const original = createV13(filename);
    original.exec(seededData);
    const tables = original
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    assert.deepEqual(
      tables.filter((name) => (v14Tables as readonly string[]).includes(name)),
      [],
    );
    const rows = (database: DatabaseSync) =>
      tables.map((table) => database.prepare(`SELECT * FROM ${table}`).all());
    const before = rows(original);
    original.close();

    const migrated = open(filename);
    assert.deepEqual(rows(migrated.connection), before);
    assert.equal(
      migrated.connection.prepare("PRAGMA user_version").get()?.user_version,
      14,
    );
    for (const table of v14Tables) {
      assert.deepEqual(
        migrated.connection.prepare(`SELECT * FROM ${table}`).all(),
        [],
      );
    }
    migrated.connection
      .prepare(
        `INSERT INTO user_emails (user_id, email, created_at, updated_at)
         VALUES ('u2', 'alice@example.com', 2, 2)`,
      )
      .run();
    assert.throws(
      () =>
        migrated.connection
          .prepare(
            `INSERT INTO user_emails (user_id, email, created_at, updated_at)
             VALUES ('u', 'ALICE@example.com', 2, 2)`,
          )
          .run(),
      /UNIQUE constraint failed: user_emails.email/,
    );
    assert.throws(
      () =>
        migrated.connection
          .prepare(
            `INSERT INTO user_emails (user_id, email, created_at, updated_at)
             VALUES ('missing', 'orphan@example.com', 2, 2)`,
          )
          .run(),
      /FOREIGN KEY constraint failed/,
    );
    assert.deepEqual(
      migrated.connection.prepare("PRAGMA foreign_key_check").all(),
      [],
    );
    assert.equal(
      migrated.connection.prepare("PRAGMA integrity_check").get()
        ?.integrity_check,
      "ok",
    );
    migrated.close();

    const backups = () =>
      readdirSync(root).filter((name) =>
        name.startsWith("case.sqlite.v13-backup-"),
      );
    assert.equal(backups().length, 1);
    const backup = new DatabaseSync(join(root, backups()[0]!), {
      readOnly: true,
    });
    assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 13);
    assert.deepEqual(rows(backup), before);
    assert.equal(
      backup.prepare("PRAGMA integrity_check").get()?.integrity_check,
      "ok",
    );
    backup.close();

    const restarted = open(filename);
    assert.equal(
      restarted.connection.prepare("PRAGMA user_version").get()?.user_version,
      14,
    );
    assert.equal(
      (
        restarted.connection
          .prepare("SELECT COUNT(*) AS count FROM user_emails")
          .get() as { readonly count: number }
      ).count,
      1,
    );
    restarted.close();
    assert.equal(backups().length, 1);

    // Fail the migration to prove the added tables and version roll back together.
    const rollbackFilename = join(root, "rollback.sqlite");
    const broken = createV13(rollbackFilename);
    broken.exec("CREATE TABLE email_login_codes (id TEXT PRIMARY KEY);");
    broken.close();
    assert.throws(
      () => open(rollbackFilename),
      /V13 to V14 migration failed.*rolled back.*backup/,
    );
    const preservedBackupName = readdirSync(root).find((name) =>
      name.startsWith("rollback.sqlite.v13-backup-"),
    )!;
    for (const name of [rollbackFilename, join(root, preservedBackupName)]) {
      const preserved = new DatabaseSync(name, { readOnly: true });
      assert.equal(
        preserved.prepare("PRAGMA user_version").get()?.user_version,
        13,
      );
      assert.equal(
        preserved
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_emails'",
          )
          .get(),
        undefined,
      );
      assert.equal(
        preserved.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
      preserved.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
