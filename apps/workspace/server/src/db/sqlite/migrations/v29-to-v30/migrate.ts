import type { DatabaseSync } from "node:sqlite";

export function migrateV29ToV30(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`ALTER TABLE worktrees ADD COLUMN issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL CHECK (issue_id IS NULL OR kind = 'team');
CREATE INDEX IF NOT EXISTS worktrees_issue
  ON worktrees(issue_id)
  WHERE issue_id IS NOT NULL;
PRAGMA user_version = 30;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V30 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V30 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
