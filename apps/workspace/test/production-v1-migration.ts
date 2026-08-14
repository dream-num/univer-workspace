import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createWorkspaceApplication } from "../dist/server/app.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-production-v1-migration-"));
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
    VALUES ('node', 'space', NULL, 'Document', 'owner', 2, 2);
    INSERT INTO resources (id, node_id, kind, created_at, updated_at)
    VALUES ('resource', 'node', 'univer', 2, 2);
    INSERT INTO univer_resources (resource_id, unit_id, unit_type)
    VALUES ('resource', 'unit', 'doc');
  `);
  await fresh.close();

  const v1 = new DatabaseSync(databaseFilename);
  v1.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP TRIGGER univer_asset_uploads_scope_update;
    DROP TRIGGER univer_asset_uploads_trunk_unit_insert;
    DROP TRIGGER univer_assets_trunk_unit_update;
    DROP TRIGGER univer_assets_trunk_unit_insert;
    DROP TABLE univer_asset_uploads;
    DROP TABLE univer_assets;
    DROP TABLE object_deletion_jobs;
    DROP TRIGGER resources_kind_immutable;
    DROP TRIGGER univer_resources_kind_guard;
    DROP TRIGGER blob_resources_kind_guard;
    DROP TABLE blob_upload_sessions;
    DROP TABLE blob_resources;
    CREATE TABLE resources_v1 (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );
    INSERT INTO resources_v1 SELECT id, node_id, created_at, updated_at FROM resources;
    DROP TABLE resources;
    ALTER TABLE resources_v1 RENAME TO resources;
    CREATE TABLE operations_v1 (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (
        kind IN (
          'create_resource', 'create_worktree', 'add_worktree_unit',
          'create_worktree_unit', 'merge_worktree', 'discard_worktree',
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
    INSERT INTO operations_v1 SELECT * FROM operations;
    DROP TABLE operations;
    ALTER TABLE operations_v1 RENAME TO operations;
    CREATE INDEX operations_due
      ON operations(state, next_attempt_at, lease_expires_at);
    CREATE INDEX operations_actor
      ON operations(actor_user_id, created_at DESC);
    PRAGMA user_version = 1;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  v1.close();

  const migrated = createWorkspaceApplication(config, dependencies);
  try {
    const version = migrated.database.connection
      .prepare("PRAGMA user_version")
      .get() as { readonly user_version: number };
    assert.equal(version.user_version, 6);
    const resource = migrated.database.connection
      .prepare("SELECT id, kind FROM resources")
      .get() as { readonly id: string; readonly kind: string };
    assert.equal(resource.id, "resource");
    assert.equal(resource.kind, "univer");
    assert.equal(
      readdirSync(directory).filter((name) => name.includes(".v1-backup-")).length,
      1
    );
  } finally {
    await migrated.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Production build migrated and opened a V1 database.");
