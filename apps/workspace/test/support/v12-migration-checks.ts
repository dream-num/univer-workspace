import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DOWNGRADE_TO_V12_SQL } from "./v13-downgrade.js";

/** Run unchanged against source and built startup, preserving every V12 row. */
export function verifyV12Migration(
  open: (filename: string) => { connection: DatabaseSync; close(): void },
): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v12-migration-"));
  const schema = readFileSync(
    new URL("../../server/src/db/schema.sql", import.meta.url),
    "utf8",
  );
  const createV12 = (filename: string) => {
    const database = new DatabaseSync(filename);
    database.exec(schema);
    database.exec(DOWNGRADE_TO_V12_SQL);
    assert.equal(
      database.prepare("PRAGMA user_version").get()?.user_version,
      12,
    );
    return database;
  };
  const seededIdentities = `
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
      VALUES ('discord', 'dc-1', 'u', 'octocat-discord', 1, 2);
    INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at)
      VALUES ('p', 'personal', 'Personal', 'u', 1, 1);
  `;
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const original = createV12(filename);
      if (seeded) original.exec(seededIdentities);
      // A V12 database rejects the Google Provider until the migration runs.
      assert.throws(
        () =>
          original.exec(`
            INSERT INTO external_identities
              (provider, provider_subject, user_id, provider_username, created_at, updated_at)
            VALUES ('google', 'g-1', 'u2', 'alice', 1, 1)
          `),
        /CHECK constraint failed/,
      );
      const tables = original
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => String(row.name));
      // Compare only the columns each V12 table already had; V14 adds users.email.
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
        17,
      );
      if (seeded) {
        migrated.connection
          .prepare(
            `INSERT INTO external_identities
              (provider, provider_subject, user_id, provider_username, created_at, updated_at)
             VALUES ('google', 'g-1', 'u2', 'alice', 1, 1)`,
          )
          .run();
      }
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
          name.startsWith(`case-${seeded}.sqlite.v12-backup-`),
        );
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), {
        readOnly: true,
      });
      assert.equal(
        backup.prepare("PRAGMA user_version").get()?.user_version,
        12,
      );
      assert.deepEqual(rows(backup), before);
      assert.equal(
        backup.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
      backup.close();

      const restarted = open(filename);
      assert.equal(
        restarted.connection.prepare("PRAGMA user_version").get()?.user_version,
        17,
      );
      restarted.close();
      assert.equal(backups().length, 1);
    }

    // Fail the post-DDL validation to prove the rebuilt table and version roll back.
    const filename = join(root, "rollback.sqlite");
    const broken = createV12(filename);
    broken.exec(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO external_identities
        (provider, provider_subject, user_id, provider_username, created_at, updated_at)
      VALUES ('github', 'gh-orphan', 'missing', 'orphan', 1, 1);
    `);
    broken.close();
    assert.throws(
      () => open(filename),
      /V12 to V17 migration failed.*rolled back.*backup/,
    );
    for (const name of [
      "rollback.sqlite",
      readdirSync(root).find((name) =>
        name.startsWith("rollback.sqlite.v12-backup-"),
      )!,
    ]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(
        preserved.prepare("PRAGMA user_version").get()?.user_version,
        12,
      );
      assert.equal(
        preserved
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'external_identities_v12'",
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
