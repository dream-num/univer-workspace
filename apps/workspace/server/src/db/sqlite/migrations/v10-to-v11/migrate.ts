import type { DatabaseSync } from "node:sqlite";

/** The Space description is product metadata; existing rows get the empty description. */
export function migrateV10ToV11(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      ALTER TABLE spaces ADD COLUMN description TEXT NOT NULL DEFAULT '';
      PRAGMA user_version = 11;
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("V11 migration failed foreign_key_check.");
    }
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
      throw new Error("V11 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
