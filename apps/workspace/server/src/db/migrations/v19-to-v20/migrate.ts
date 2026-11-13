import type { DatabaseSync } from "node:sqlite";

export function migrateV19ToV20(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
CREATE TABLE IF NOT EXISTS skill_drafts (
  id TEXT PRIMARY KEY,
  author_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  intent_sha256 TEXT NOT NULL CHECK (length(intent_sha256) = 64),
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_folder_node_id TEXT,
  files TEXT NOT NULL CHECK (json_valid(files)),
  base TEXT CHECK (base IS NULL OR json_valid(base)),
  keep TEXT NOT NULL CHECK (json_valid(keep)),
  scan TEXT NOT NULL CHECK (json_valid(scan)),
  review TEXT NOT NULL CHECK (json_valid(review)),
  source TEXT CHECK (source IS NULL OR json_valid(source)),
  unverified_review_count INTEGER NOT NULL CHECK (unverified_review_count >= 0),
  state TEXT NOT NULL CHECK (state IN
    ('receiving', 'pending', 'published', 'rejected', 'expired', 'conflicted')),
  result_folder_node_id TEXT,
  decided_by TEXT, decided_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (author_user_id, idempotency_key),
  CHECK ((base IS NULL) = (target_folder_node_id IS NULL)),
  CHECK ((state = 'published') = (result_folder_node_id IS NOT NULL)),
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS skill_drafts_due
  ON skill_drafts(expires_at, id) WHERE state IN ('receiving', 'pending');

PRAGMA user_version = 20;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V20 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V20 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
