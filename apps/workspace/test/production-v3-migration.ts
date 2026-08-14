import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createWorkspaceApplication } from "../dist/server/app.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-production-v3-migration-"));
const databaseFilename = join(directory, "workspace.sqlite");
const config = {
  host: "127.0.0.1",
  port: 0,
  databaseFilename,
  collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
  blobDirectory: join(directory, "objects"),
  secureCookies: false,
  sessionTtlMs: 60_000,
} as const;
const dependencies = {
  unitStore: {
    createUnit: async (input: { readonly unitId: string }) => ({
      unitId: input.unitId,
      headRevision: 1,
    }),
  },
};

try {
  const fresh = createWorkspaceApplication(config, dependencies);
  fresh.database.connection.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 1, 1);
    INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at)
    VALUES ('space', 'personal', 'Personal', 'owner', 1, 1);
    INSERT INTO nodes
      (id, space_id, parent_id, name, created_by, created_at, updated_at)
    VALUES ('node', 'space', NULL, 'Slide', 'owner', 2, 2);
    INSERT INTO resources (id, node_id, kind, created_at, updated_at)
    VALUES ('resource', 'node', 'univer', 2, 2);
    INSERT INTO univer_resources (resource_id, unit_id, unit_type)
    VALUES ('resource', 'unit', 'slide');
    INSERT INTO univer_asset_uploads
      (
        id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
        original_filename, declared_media_type, expected_size, received_size,
        sha256, etag, state, created_at, updated_at, expires_at
      )
    VALUES (
      'upload', 'asset', 'unit', NULL,
      '00000000-0000-4000-8000-000000000030', 'owner', 'asset.webp',
      'image/webp', 9, NULL, NULL, NULL, 'receiving', 3, 3, 1000
    );
  `);
  await fresh.close();

  const v3 = new DatabaseSync(databaseFilename);
  v3.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP TRIGGER univer_asset_uploads_scope_update;
    DROP TRIGGER univer_asset_uploads_trunk_unit_insert;
    DROP INDEX univer_asset_uploads_recovery;
    ALTER TABLE univer_asset_uploads RENAME TO univer_asset_uploads_v4;
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
    INSERT INTO univer_asset_uploads
      (
        id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
        original_filename, declared_media_type, detected_media_type,
        expected_size, received_size, sha256, etag, state, created_at,
        updated_at, expires_at
      )
    SELECT
      id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
      original_filename, declared_media_type, NULL, expected_size,
      received_size, sha256, etag, state, created_at, updated_at, expires_at
    FROM univer_asset_uploads_v4;
    DROP TABLE univer_asset_uploads_v4;
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
    PRAGMA user_version = 3;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  v3.close();

  const migrated = createWorkspaceApplication(config, dependencies);
  try {
    const version = migrated.database.connection
      .prepare("PRAGMA user_version")
      .get() as { readonly user_version: number };
    assert.equal(version.user_version, 6);
    const columns = migrated.database.connection
      .prepare("PRAGMA table_info(univer_asset_uploads)")
      .all() as unknown as Array<{ readonly name: string }>;
    assert.equal(columns.some((column) => column.name === "detected_media_type"), false);
    assert.equal(
      readdirSync(directory).filter((name) => name.includes(".v3-backup-")).length,
      1
    );
  } finally {
    await migrated.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Production build migrated and opened a V3 database.");
