import type { DatabaseSync } from "node:sqlite";

export function migrateV31ToV32(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS worktree_checks (
  worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
  content_key TEXT NOT NULL,
  name TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('passed', 'failed')),
  summary TEXT NOT NULL DEFAULT '',
  reported_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, content_key, name, reporter_user_id)
);
PRAGMA user_version = 32;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V32 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V32 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
