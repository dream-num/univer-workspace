import type { DatabaseSync } from "node:sqlite";

export function migrateV25ToV26(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`ALTER TABLE html_view_drafts ADD COLUMN source_worktree_id TEXT;
CREATE INDEX html_view_drafts_source_worktree
  ON html_view_drafts(source_worktree_id, expires_at, id) WHERE state = 'pending';
PRAGMA user_version = 26;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V26 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V26 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
