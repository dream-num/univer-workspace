import type { DatabaseSync } from "node:sqlite";

export function migrateV27ToV28(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`CREATE TABLE forks (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  upstream_space_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  UNIQUE (owner_user_id, name),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (upstream_space_id) REFERENCES spaces(id) ON DELETE CASCADE
);
ALTER TABLE worktrees ADD COLUMN fork_id TEXT REFERENCES forks(id) ON DELETE SET NULL CHECK (fork_id IS NULL OR kind = 'team');
CREATE UNIQUE INDEX worktrees_open_fork
  ON worktrees(fork_id)
  WHERE fork_id IS NOT NULL AND processed_at IS NULL;
PRAGMA user_version = 28;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V28 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V28 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
