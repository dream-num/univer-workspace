import type { DatabaseSync } from "node:sqlite";

export function migrateV32ToV33(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`ALTER TABLE spaces ADD COLUMN landing TEXT NOT NULL DEFAULT 'review' CHECK (landing IN ('review', 'checks'));
PRAGMA user_version = 33;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V33 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V33 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
