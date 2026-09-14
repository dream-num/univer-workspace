import type { DatabaseSync } from "node:sqlite";

/** V6 -> V7: preserve all rows while extending Operation and cleanup reasons. */
export function migrateV6ToV7(database: DatabaseSync): void {
  const foreignKeys = (database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number })
    .foreign_keys;
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`

      CREATE TABLE operations_v7 (
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
      INSERT INTO operations_v7 (id, kind, actor_user_id, step, state, payload_json, result_json, attempt_count, next_attempt_at, last_error_code, last_error_message, lease_owner, lease_expires_at, created_at, updated_at, completed_at) SELECT id, kind, actor_user_id, step, state, payload_json, result_json, attempt_count, next_attempt_at, last_error_code, last_error_message, lease_owner, lease_expires_at, created_at, updated_at, completed_at FROM operations;
      DROP TABLE operations;
      ALTER TABLE operations_v7 RENAME TO operations;
      CREATE INDEX IF NOT EXISTS operations_due
        ON operations(state, next_attempt_at, lease_expires_at);
      CREATE INDEX IF NOT EXISTS operations_actor
        ON operations(actor_user_id, created_at DESC);
      CREATE TABLE object_deletion_jobs_v7 (
        id TEXT PRIMARY KEY,
        object_key TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL CHECK (
          reason IN (
            'blob_resource_deleted',
            'blob_content_replaced',
            'blob_upload_abandoned',
            'univer_unit_deleted',
            'univer_asset_upload_abandoned',
            'worktree_asset_expired'
          )
        ),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at INTEGER NOT NULL,
        lease_owner TEXT,
        lease_expires_at INTEGER,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO object_deletion_jobs_v7 (id, object_key, reason, attempt_count, next_attempt_at, lease_owner, lease_expires_at, last_error_code, last_error_message, created_at, updated_at) SELECT id, object_key, reason, attempt_count, next_attempt_at, lease_owner, lease_expires_at, last_error_code, last_error_message, created_at, updated_at FROM object_deletion_jobs;
      DROP TABLE object_deletion_jobs;
      ALTER TABLE object_deletion_jobs_v7 RENAME TO object_deletion_jobs;
      CREATE INDEX IF NOT EXISTS object_deletion_jobs_due
        ON object_deletion_jobs(next_attempt_at, lease_expires_at, id);
      PRAGMA user_version = 7;
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("V7 migration failed foreign_key_check.");
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: unknown;
    };
    if (integrity.integrity_check !== "ok") throw new Error("V7 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec(`PRAGMA foreign_keys = ${foreignKeys}`);
  }
}
