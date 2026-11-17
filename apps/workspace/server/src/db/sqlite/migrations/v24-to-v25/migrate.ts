import type { DatabaseSync } from "node:sqlite";
import { repairDisplayNames } from "../v21-to-v22/migrate.js";

// Scope, failure semantics and exit condition: see planDisplayNameRepair in db/display-name-repair.ts.
export function migrateV24ToV25(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    repairDisplayNames(database);
    database.exec("PRAGMA user_version = 25");
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V25 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V25 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
