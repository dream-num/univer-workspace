import type { DatabaseSync } from "node:sqlite";

/**
 * Allow the Google Provider in External Identities. Every other column, constraint,
 * and row is preserved; the table is rebuilt because SQLite cannot alter a CHECK.
 */
export function migrateV12ToV13(database: DatabaseSync): void {
  const previousIdentities = database.prepare(
    `SELECT provider, provider_subject, user_id, provider_username,
            created_at, updated_at
     FROM external_identities
     ORDER BY provider, provider_subject`
  ).all();

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      ALTER TABLE external_identities RENAME TO external_identities_v12;
      CREATE TABLE external_identities (
        provider TEXT NOT NULL CHECK (provider IN ('github', 'google', 'discord')),
        provider_subject TEXT NOT NULL,
        user_id TEXT NOT NULL,
        provider_username TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, provider_subject),
        UNIQUE (user_id, provider),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO external_identities
        (provider, provider_subject, user_id, provider_username, created_at, updated_at)
      SELECT
        provider, provider_subject, user_id, provider_username, created_at, updated_at
      FROM external_identities_v12;
      DROP TABLE external_identities_v12;
      PRAGMA user_version = 13;
    `);
    const migratedIdentities = database.prepare(
      `SELECT provider, provider_subject, user_id, provider_username,
              created_at, updated_at
       FROM external_identities
       ORDER BY provider, provider_subject`
    ).all();
    if (JSON.stringify(migratedIdentities) !== JSON.stringify(previousIdentities)) {
      throw new Error("V13 migration did not preserve every External Identity.");
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("V13 migration failed foreign_key_check.");
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      readonly integrity_check?: unknown;
    };
    if (integrity.integrity_check !== "ok") {
      throw new Error("V13 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}
