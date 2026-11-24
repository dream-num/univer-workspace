import type { DatabaseSync } from "node:sqlite";

export function migrateV30ToV31(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`ALTER TABLE spaces ADD COLUMN accept_after_hours INTEGER CHECK (accept_after_hours > 0);
CREATE TABLE IF NOT EXISTS issue_verdicts (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('submitted', 'accepted', 'sent_back', 'reverted')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL DEFAULT '',
  operation_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (actor_user_id IS NOT NULL OR kind = 'accepted'),
  CHECK (operation_id IS NULL OR kind = 'reverted')
);
CREATE INDEX IF NOT EXISTS issue_verdicts_issue ON issue_verdicts(issue_id, created_at, id);
PRAGMA user_version = 31;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V31 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V31 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
