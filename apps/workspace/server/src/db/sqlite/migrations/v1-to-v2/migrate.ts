import { DatabaseSync } from "node:sqlite";

/** Temporary, removable V1 -> V2 migration boundary. */
export function migrateV1ToV2(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE resources_v2 (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('univer', 'blob')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );
      INSERT INTO resources_v2 (id, node_id, kind, created_at, updated_at)
      SELECT id, node_id, 'univer', created_at, updated_at FROM resources;
      DROP TABLE resources;
      ALTER TABLE resources_v2 RENAME TO resources;

      CREATE TABLE operations_v2 (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (
          kind IN (
            'create_resource',
            'create_blob_resource',
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
      INSERT INTO operations_v2
      SELECT * FROM operations;
      DROP TABLE operations;
      ALTER TABLE operations_v2 RENAME TO operations;
    `);
    database.exec(V2_ADDITIONS);
    assertV2Data(database);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function assertV2Data(database: DatabaseSync): void {
  const invalid = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM resources AS resource
       LEFT JOIN univer_resources AS univer
         ON univer.resource_id = resource.id
       LEFT JOIN blob_resources AS blob
         ON blob.resource_id = resource.id
       WHERE resource.kind <> 'univer'
          OR univer.resource_id IS NULL
          OR blob.resource_id IS NOT NULL`
    )
    .get() as { readonly count: number };
  if (invalid.count !== 0) {
    throw new Error("V1 Resource rows did not migrate to valid Univer Resources.");
  }
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) {
    throw new Error("V2 migration failed foreign_key_check.");
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as {
    readonly integrity_check?: unknown;
  };
  if (integrity.integrity_check !== "ok") {
    throw new Error("V2 migration failed integrity_check.");
  }
}

const V2_ADDITIONS = `
  CREATE INDEX operations_due
    ON operations(state, next_attempt_at, lease_expires_at);
  CREATE INDEX operations_actor
    ON operations(actor_user_id, created_at DESC);

  CREATE TABLE blob_resources (
    resource_id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    etag TEXT NOT NULL,
    availability TEXT NOT NULL CHECK (
      availability IN ('ready', 'quarantined')
    ),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );

  CREATE TABLE blob_upload_sessions (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL UNIQUE,
    actor_user_id TEXT NOT NULL,
    target_space_id TEXT NOT NULL,
    target_parent_node_id TEXT,
    node_id TEXT NOT NULL UNIQUE,
    resource_id TEXT NOT NULL UNIQUE,
    object_key TEXT NOT NULL UNIQUE,
    node_name TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    declared_media_type TEXT,
    detected_media_type TEXT,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    received_size INTEGER CHECK (received_size >= 0),
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    etag TEXT,
    state TEXT NOT NULL CHECK (
      state IN (
        'waiting_for_upload', 'uploaded', 'verifying',
        'completed', 'failed', 'expired', 'aborted'
      )
    ),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    last_error_code TEXT,
    last_error_message TEXT,
    FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (target_space_id) REFERENCES spaces(id) ON DELETE RESTRICT,
    FOREIGN KEY (target_parent_node_id) REFERENCES nodes(id) ON DELETE RESTRICT
  );
  CREATE INDEX blob_upload_sessions_actor
    ON blob_upload_sessions(actor_user_id, created_at DESC, id);
  CREATE INDEX blob_upload_sessions_recovery
    ON blob_upload_sessions(state, expires_at, updated_at, id);

  CREATE TABLE blob_deletion_jobs (
    id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL CHECK (
      reason IN ('resource_deleted', 'upload_abandoned')
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
  CREATE INDEX blob_deletion_jobs_due
    ON blob_deletion_jobs(next_attempt_at, lease_expires_at, id);

  CREATE TRIGGER resources_kind_immutable
  BEFORE UPDATE OF kind ON resources
  FOR EACH ROW
  WHEN NEW.kind <> OLD.kind
  BEGIN
    SELECT RAISE(ABORT, 'resource kind is immutable');
  END;

  CREATE TRIGGER univer_resources_kind_guard
  BEFORE INSERT ON univer_resources
  FOR EACH ROW
  WHEN COALESCE(
    (SELECT kind FROM resources WHERE id = NEW.resource_id),
    ''
  ) <> 'univer'
  BEGIN
    SELECT RAISE(ABORT, 'univer extension requires kind=univer');
  END;

  CREATE TRIGGER blob_resources_kind_guard
  BEFORE INSERT ON blob_resources
  FOR EACH ROW
  WHEN COALESCE(
    (SELECT kind FROM resources WHERE id = NEW.resource_id),
    ''
  ) <> 'blob'
  BEGIN
    SELECT RAISE(ABORT, 'blob extension requires kind=blob');
  END;

  PRAGMA user_version = 2;
`;
