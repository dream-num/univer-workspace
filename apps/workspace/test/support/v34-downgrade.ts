import { DROP_V35_SQL } from "./v35-downgrade.js";

/**
 * Rebuilds Operations with the V33 kind CHECK (no revert_worktrees) so a schema.sql-built
 * fixture reads as V33. Operations rows are carried over; every other structure is untouched.
 */
export const DROP_V34_SQL = `${DROP_V35_SQL}
  PRAGMA foreign_keys = OFF;
  CREATE TABLE operations_v33 (
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
  INSERT INTO operations_v33 SELECT * FROM operations;
  DROP TABLE operations;
  ALTER TABLE operations_v33 RENAME TO operations;
  CREATE INDEX operations_due
    ON operations(state, next_attempt_at, lease_expires_at);
  CREATE INDEX operations_actor
    ON operations(actor_user_id, created_at DESC);
  PRAGMA foreign_keys = ON;
`;
