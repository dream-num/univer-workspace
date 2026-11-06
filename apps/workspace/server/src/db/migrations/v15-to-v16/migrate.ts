import type { DatabaseSync } from "node:sqlite";

export function migrateV15ToV16(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      ALTER TABLE login_sessions ADD COLUMN write_source TEXT CHECK (write_source IN ('browser', 'agent'));
      ALTER TABLE worktrees ADD COLUMN created_via TEXT CHECK (created_via IN ('browser', 'agent'));
      ALTER TABLE issues ADD COLUMN created_via TEXT CHECK (created_via IN ('browser', 'agent'));
      PRAGMA user_version = 16;
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("V16 migration failed foreign_key_check.");
    }
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
      throw new Error("V16 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
