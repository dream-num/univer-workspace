import type { DatabaseSync } from "node:sqlite";

/** Temporary, removable V2 -> V3 migration boundary. */
export function migrateV2ToV3(database: DatabaseSync): void {
  const previousDeletionJobs = count(database, "blob_deletion_jobs");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE univer_assets (
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        worktree_id TEXT,
        object_key TEXT NOT NULL UNIQUE,
        original_filename TEXT NOT NULL,
        media_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        etag TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (worktree_id, unit_id)
          REFERENCES worktree_units(worktree_id, unit_id)
          ON DELETE RESTRICT,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX univer_assets_trunk_unit
        ON univer_assets(unit_id, created_at, id)
        WHERE worktree_id IS NULL;
      CREATE INDEX univer_assets_worktree_unit
        ON univer_assets(worktree_id, unit_id, created_at, id)
        WHERE worktree_id IS NOT NULL;

      CREATE TABLE univer_asset_uploads (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL UNIQUE,
        unit_id TEXT NOT NULL,
        worktree_id TEXT,
        object_key TEXT NOT NULL UNIQUE,
        actor_user_id TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        declared_media_type TEXT,
        detected_media_type TEXT,
        expected_size INTEGER NOT NULL CHECK (expected_size >= 0),
        received_size INTEGER CHECK (received_size >= 0),
        sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
        etag TEXT,
        state TEXT NOT NULL CHECK (state IN ('receiving', 'stored')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        CHECK (
          state = 'receiving'
          OR (
            received_size = expected_size
            AND detected_media_type IS NOT NULL
            AND sha256 IS NOT NULL
            AND etag IS NOT NULL
          )
        ),
        FOREIGN KEY (worktree_id, unit_id)
          REFERENCES worktree_units(worktree_id, unit_id)
          ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX univer_asset_uploads_recovery
        ON univer_asset_uploads(state, expires_at, updated_at, id);

      CREATE TABLE object_deletion_jobs (
        id TEXT PRIMARY KEY,
        object_key TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL CHECK (
          reason IN (
            'blob_resource_deleted',
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
      INSERT INTO object_deletion_jobs
        (
          id, object_key, reason, attempt_count, next_attempt_at,
          lease_owner, lease_expires_at, last_error_code,
          last_error_message, created_at, updated_at
        )
      SELECT
        id,
        object_key,
        CASE reason
          WHEN 'resource_deleted' THEN 'blob_resource_deleted'
          WHEN 'upload_abandoned' THEN 'blob_upload_abandoned'
        END,
        attempt_count,
        next_attempt_at,
        lease_owner,
        lease_expires_at,
        last_error_code,
        last_error_message,
        created_at,
        updated_at
      FROM blob_deletion_jobs;
      DROP INDEX blob_deletion_jobs_due;
      DROP TABLE blob_deletion_jobs;
      CREATE INDEX object_deletion_jobs_due
        ON object_deletion_jobs(next_attempt_at, lease_expires_at, id);

      CREATE TRIGGER univer_assets_trunk_unit_insert
      BEFORE INSERT ON univer_assets
      FOR EACH ROW
      WHEN NEW.worktree_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'trunk asset requires an existing Univer unit');
      END;

      CREATE TRIGGER univer_assets_trunk_unit_update
      BEFORE UPDATE OF unit_id, worktree_id ON univer_assets
      FOR EACH ROW
      WHEN NEW.worktree_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'trunk asset requires an existing Univer unit');
      END;

      CREATE TRIGGER univer_asset_uploads_trunk_unit_insert
      BEFORE INSERT ON univer_asset_uploads
      FOR EACH ROW
      WHEN NEW.worktree_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'trunk asset upload requires an existing Univer unit');
      END;

      CREATE TRIGGER univer_asset_uploads_scope_update
      BEFORE UPDATE OF unit_id, worktree_id ON univer_asset_uploads
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'asset upload scope is immutable');
      END;

      PRAGMA user_version = 3;
    `);
    assertV3Data(database, previousDeletionJobs);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function assertV3Data(database: DatabaseSync, previousDeletionJobs: number): void {
  if (count(database, "object_deletion_jobs") !== previousDeletionJobs) {
    throw new Error("V3 migration did not preserve every Object Deletion Job.");
  }
  const invalidReason = database.prepare(
    `SELECT COUNT(*) AS count
     FROM object_deletion_jobs
     WHERE reason NOT IN ('blob_resource_deleted', 'blob_upload_abandoned')`
  ).get() as { readonly count: number };
  if (invalidReason.count !== 0) {
    throw new Error("V3 migration produced an invalid Object Deletion reason.");
  }
  if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("V3 migration failed foreign_key_check.");
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as {
    readonly integrity_check?: unknown;
  };
  if (integrity.integrity_check !== "ok") {
    throw new Error("V3 migration failed integrity_check.");
  }
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    readonly count: number;
  };
  return row.count;
}
