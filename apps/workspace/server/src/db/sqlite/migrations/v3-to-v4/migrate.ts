import type { DatabaseSync } from "node:sqlite";

/** Remove content-derived media metadata from Univer Asset upload sessions. */
export function migrateV3ToV4(database: DatabaseSync): void {
  const previousUploads = database.prepare(
    `SELECT id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
            original_filename,
            COALESCE(declared_media_type, detected_media_type) AS declared_media_type,
            expected_size,
            received_size, sha256, etag, state, created_at, updated_at,
            expires_at
     FROM univer_asset_uploads
     ORDER BY id`
  ).all();

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DROP TRIGGER univer_asset_uploads_scope_update;
      DROP TRIGGER univer_asset_uploads_trunk_unit_insert;
      DROP INDEX univer_asset_uploads_recovery;
      ALTER TABLE univer_asset_uploads RENAME TO univer_asset_uploads_v3;

      CREATE TABLE univer_asset_uploads (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL UNIQUE,
        unit_id TEXT NOT NULL,
        worktree_id TEXT,
        object_key TEXT NOT NULL UNIQUE,
        actor_user_id TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        declared_media_type TEXT,
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
            AND sha256 IS NOT NULL
            AND etag IS NOT NULL
          )
        ),
        FOREIGN KEY (worktree_id, unit_id)
          REFERENCES worktree_units(worktree_id, unit_id)
          ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO univer_asset_uploads
        (
          id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
          original_filename, declared_media_type, expected_size,
          received_size, sha256, etag, state, created_at, updated_at,
          expires_at
        )
      SELECT
        id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
        original_filename, COALESCE(declared_media_type, detected_media_type), expected_size,
        received_size, sha256, etag, state, created_at, updated_at,
        expires_at
      FROM univer_asset_uploads_v3;

      DROP TABLE univer_asset_uploads_v3;

      CREATE INDEX univer_asset_uploads_recovery
        ON univer_asset_uploads(state, expires_at, updated_at, id);

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

      PRAGMA user_version = 4;
    `);
    assertV4Data(database, previousUploads);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function assertV4Data(database: DatabaseSync, previousUploads: unknown[]): void {
  const migratedUploads = database.prepare(
    `SELECT id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
            original_filename, declared_media_type, expected_size,
            received_size, sha256, etag, state, created_at, updated_at,
            expires_at
     FROM univer_asset_uploads
     ORDER BY id`
  ).all();
  if (JSON.stringify(migratedUploads) !== JSON.stringify(previousUploads)) {
    throw new Error("V4 migration did not preserve every Univer Asset Upload.");
  }
  if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("V4 migration failed foreign_key_check.");
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as {
    readonly integrity_check?: unknown;
  };
  if (integrity.integrity_check !== "ok") {
    throw new Error("V4 migration failed integrity_check.");
  }
}
