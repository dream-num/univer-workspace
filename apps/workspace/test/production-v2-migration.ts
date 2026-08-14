import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createWorkspaceApplication } from "../dist/server/app.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-production-v2-migration-"));
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
    INSERT INTO object_deletion_jobs
      (id, object_key, reason, next_attempt_at, created_at, updated_at)
    VALUES (
      'delete', '00000000-0000-4000-8000-000000000001',
      'blob_upload_abandoned', 1, 1, 1
    );
  `);
  await fresh.close();

  const v2 = new DatabaseSync(databaseFilename);
  v2.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP TRIGGER univer_asset_uploads_scope_update;
    DROP TRIGGER univer_asset_uploads_trunk_unit_insert;
    DROP TRIGGER univer_assets_trunk_unit_update;
    DROP TRIGGER univer_assets_trunk_unit_insert;
    DROP TABLE univer_asset_uploads;
    DROP TABLE univer_assets;
    ALTER TABLE object_deletion_jobs RENAME TO object_deletion_jobs_v3;
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
    INSERT INTO blob_deletion_jobs
      (
        id, object_key, reason, attempt_count, next_attempt_at,
        lease_owner, lease_expires_at, last_error_code,
        last_error_message, created_at, updated_at
      )
    SELECT
      id, object_key, 'upload_abandoned', attempt_count, next_attempt_at,
      lease_owner, lease_expires_at, last_error_code,
      last_error_message, created_at, updated_at
    FROM object_deletion_jobs_v3;
    DROP TABLE object_deletion_jobs_v3;
    CREATE INDEX blob_deletion_jobs_due
      ON blob_deletion_jobs(next_attempt_at, lease_expires_at, id);
    PRAGMA user_version = 2;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  v2.close();

  const migrated = createWorkspaceApplication(config, dependencies);
  try {
    const version = migrated.database.connection
      .prepare("PRAGMA user_version")
      .get() as { readonly user_version: number };
    assert.equal(version.user_version, 6);
    const deletion = migrated.database.connection
      .prepare("SELECT reason FROM object_deletion_jobs")
      .get() as { readonly reason: string };
    assert.equal(deletion.reason, "blob_upload_abandoned");
    assert.equal(
      readdirSync(directory).filter((name) => name.includes(".v2-backup-")).length,
      1
    );
  } finally {
    await migrated.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Production build migrated and opened a V2 database.");
