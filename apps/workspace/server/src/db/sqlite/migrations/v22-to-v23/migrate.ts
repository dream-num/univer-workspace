import type { DatabaseSync } from "node:sqlite";

/** Every User starts without executor access; no row is rewritten. */
export function migrateV22ToV23(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
CREATE TABLE executor_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL
);

PRAGMA user_version = 23;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V23 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V23 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
