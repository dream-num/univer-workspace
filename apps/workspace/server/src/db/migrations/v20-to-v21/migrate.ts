import type { DatabaseSync } from "node:sqlite";

/** Existing Users read as 'human' through the column default; no row is rewritten. */
export function migrateV20ToV21(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'agent'));
CREATE TABLE agents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  claimed_at INTEGER,
  origin_label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  expires_at INTEGER,
  banned_at INTEGER,
  CHECK ((owner_user_id IS NULL) = (claimed_at IS NULL))
);

CREATE TABLE node_reports (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  reporter_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

PRAGMA user_version = 21;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V21 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V21 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
