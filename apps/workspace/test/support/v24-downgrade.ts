import { DROP_V26_SQL, withoutV26Columns } from "./v26-downgrade.js";
import assert from "node:assert/strict";

/**
 * Removes the V24 copy-source and Link Sharing columns, then rebuilds Operations
 * with the V23 kind CHECK (no copy_node) so a schema.sql-built fixture reads as
 * V23. The index goes first because a column named by an index cannot be dropped.
 * Operations rows are carried over; every other structure and row is untouched.
 */
export const DROP_V24_SQL = `
  ${DROP_V26_SQL}
  DROP INDEX IF EXISTS nodes_copied_from;
  ALTER TABLE nodes DROP COLUMN copied_from_node_id;
  ALTER TABLE worktree_node_intents DROP COLUMN copied_from_node_id;
  ALTER TABLE node_link_sharing DROP COLUMN unverified_role;
  ALTER TABLE node_link_sharing DROP COLUMN making_of_note;
  PRAGMA foreign_keys = OFF;
  CREATE TABLE operations_v23 (
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
        'activate_worktree_resource'
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
  INSERT INTO operations_v23 SELECT * FROM operations;
  DROP TABLE operations;
  ALTER TABLE operations_v23 RENAME TO operations;
  CREATE INDEX operations_due
    ON operations(state, next_attempt_at, lease_expires_at);
  CREATE INDEX operations_actor
    ON operations(actor_user_id, created_at DESC);
  PRAGMA foreign_keys = ON;
`;

const V24_COLUMNS: Record<string, Record<string, unknown>> = {
  nodes: { copied_from_node_id: null },
  worktree_node_intents: { copied_from_node_id: null },
  node_link_sharing: { unverified_role: "viewer", making_of_note: null },
};

/** Drops the columns V24 appends after checking each holds the value an older row must read. */
export function withoutV24Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return withoutV26Columns(table, rows).map((row) => {
    const rest = { ...row };
    for (const [column, value] of Object.entries(V24_COLUMNS[table] ?? {})) {
      if (column in rest) assert.equal(rest[column], value);
      delete rest[column];
    }
    return rest;
  });
}
