import type { DatabaseSync } from "node:sqlite";

/**
 * V23 -> V24: record where a copied file came from and accept the copy Operation.
 * Existing Nodes and intents read NULL (not a copy), existing Link Sharing reads
 * 'viewer' for unverified readers and no making-of note. Operations are rebuilt
 * row for row because SQLite cannot alter the kind CHECK in place.
 */
export function migrateV23ToV24(database: DatabaseSync): void {
  const foreignKeys = (database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number })
    .foreign_keys;
  // Dropping operations with enforcement on would cascade into blob_upload_sessions.
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
ALTER TABLE nodes ADD COLUMN copied_from_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL;
CREATE INDEX nodes_copied_from
  ON nodes(copied_from_node_id)
  WHERE copied_from_node_id IS NOT NULL;
ALTER TABLE worktree_node_intents ADD COLUMN copied_from_node_id TEXT;
ALTER TABLE node_link_sharing ADD COLUMN unverified_role TEXT NOT NULL DEFAULT 'viewer' CHECK (unverified_role IN ('editor', 'viewer'));
ALTER TABLE node_link_sharing ADD COLUMN making_of_note TEXT;

CREATE TABLE operations_v24 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'create_resource',
      'create_blob_resource',
      'replace_blob_content',
      'create_worktree',
      'add_worktree_unit',
      'create_worktree_unit',
      'merge_worktree',
      'discard_worktree',
      'activate_worktree_resource',
      'copy_node'
    )
  ),
  actor_user_id TEXT NOT NULL,
  step TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  payload_json TEXT NOT NULL,
  result_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_error_code TEXT,
  last_error_message TEXT,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
INSERT INTO operations_v24 (id, kind, actor_user_id, step, state, payload_json, result_json, attempt_count, next_attempt_at, last_error_code, last_error_message, lease_owner, lease_expires_at, created_at, updated_at, completed_at)
  SELECT id, kind, actor_user_id, step, state, payload_json, result_json, attempt_count, next_attempt_at, last_error_code, last_error_message, lease_owner, lease_expires_at, created_at, updated_at, completed_at FROM operations;
DROP TABLE operations;
ALTER TABLE operations_v24 RENAME TO operations;
CREATE INDEX operations_due
  ON operations(state, next_attempt_at, lease_expires_at);
CREATE INDEX operations_actor
  ON operations(actor_user_id, created_at DESC);

PRAGMA user_version = 24;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V24 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V24 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec(`PRAGMA foreign_keys = ${foreignKeys}`);
  }
}
