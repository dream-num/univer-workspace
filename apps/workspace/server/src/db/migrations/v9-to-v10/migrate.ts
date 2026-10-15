import type { DatabaseSync } from "node:sqlite";

/** Stars are product metadata; existing Space, content and recovery rows stay unchanged. */
export function migrateV9ToV10(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE space_stars (
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (space_id, user_id)
      );
      PRAGMA user_version = 10;
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("V10 migration failed foreign_key_check.");
    }
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
      throw new Error("V10 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
