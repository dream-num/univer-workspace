import type { DatabaseSync } from "node:sqlite";

export function migrateV28ToV29(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`ALTER TABLE spaces ADD COLUMN proposals TEXT NOT NULL DEFAULT 'members' CHECK (proposals IN ('members', 'accountable', 'anyone'));
PRAGMA user_version = 29;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V29 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V29 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
