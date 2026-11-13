import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DOWNGRADE_TO_V13_SQL } from "./v13-downgrade.js";

/**
 * Run unchanged against source and built startup, preserving every V13 row and
 * proving the additive `users.email` migration rolls back as a unit.
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
  const userColumns = (database: DatabaseSync) =>
    (
      database.prepare("PRAGMA table_info(users)").all() as unknown as Array<{
        readonly name: string;
      }>
    ).map((column) => column.name);
  try {
    const filename = join(root, "case.sqlite");
    const original = createV13(filename);
    original.exec(seededData);
    assert.deepEqual(userColumns(original), [
      "id", "username", "display_name", "avatar_url", "created_at",
      "updated_at",
    ]);
    assert.equal(
      original
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'email_login_codes'",
        )
        .get(),
      undefined,
    );
    const tables = original
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    // Compare only the columns each V13 table already had; V14 adds users.email.
    const columnsByTable = new Map(
      tables.map((table) => [
        table,
        (
          original.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
            readonly name: string;
          }>
        )
          .map((column) => `"${column.name}"`)
          .join(", "),
      ]),
    );
    const rows = (database: DatabaseSync) =>
      tables.map((table) =>
        database
          .prepare(`SELECT ${columnsByTable.get(table)} FROM ${table}`)
          .all(),
      );
    const before = rows(original);
    original.close();

    const migrated = open(filename);
    assert.deepEqual(rows(migrated.connection), before);
    assert.equal(
      migrated.connection.prepare("PRAGMA user_version").get()?.user_version,
      20,
    );
    assert.deepEqual(userColumns(migrated.connection), [
      "id", "username", "display_name", "avatar_url", "created_at",
      "updated_at", "email",
    ]);
    assert.deepEqual(
      (
        migrated.connection
          .prepare("SELECT id, email FROM users ORDER BY id")
          .all() as unknown as Array<{ readonly id: string }>
      ).map((row) => ({ ...row })),
      [
        { id: "u", email: null },
        { id: "u2", email: null },
      ],
    );
    assert.deepEqual(
      migrated.connection.prepare("SELECT * FROM email_login_codes").all(),
      [],
    );
    migrated.connection
      .prepare("UPDATE users SET email = 'alice@example.com' WHERE id = 'u2'")
      .run();
    assert.throws(
      () =>
        migrated.connection
          .prepare("UPDATE users SET email = 'ALICE@example.com' WHERE id = 'u'")
          .run(),
      /UNIQUE constraint failed: users.email/,
    );
    migrated.connection
      .prepare(
        `INSERT INTO users (id, username, display_name, created_at, updated_at)
         VALUES ('u3', 'third', 'Third', 2, 2)`,
      )
      .run();
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
    assert.deepEqual(userColumns(backup), [
      "id", "username", "display_name", "avatar_url", "created_at",
      "updated_at",
    ]);
    assert.equal(
      backup.prepare("PRAGMA integrity_check").get()?.integrity_check,
      "ok",
    );
    backup.close();

    const restarted = open(filename);
    assert.equal(
      restarted.connection.prepare("PRAGMA user_version").get()?.user_version,
      20,
    );
    assert.equal(
      (
        restarted.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM users WHERE email IS NOT NULL",
          )
          .get() as { readonly count: number }
      ).count,
      1,
    );
    restarted.close();
    assert.equal(backups().length, 1);

    // Fail the migration to prove the added column, table, and version roll back.
    const rollbackFilename = join(root, "rollback.sqlite");
    const broken = createV13(rollbackFilename);
    broken.exec("CREATE TABLE email_login_codes (id TEXT PRIMARY KEY);");
    broken.close();
    assert.throws(
      () => open(rollbackFilename),
      /V13 to V20 migration failed.*rolled back.*backup/,
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
      assert.deepEqual(userColumns(preserved), [
        "id", "username", "display_name", "avatar_url", "created_at",
        "updated_at",
      ]);
      assert.equal(
        preserved
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'users_email'",
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
