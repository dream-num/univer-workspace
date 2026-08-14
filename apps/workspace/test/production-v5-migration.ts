import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-production-v5-migration-"));
const databaseFilename = join(directory, "workspace.sqlite");

try {
  const fresh = openWorkspaceDatabase(databaseFilename);
  fresh.connection.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 1, 1);
    INSERT INTO spaces
      (id, type, name, owner_user_id, created_at, updated_at)
    VALUES ('space', 'personal', 'Existing space', 'owner', 1, 1);
    ALTER TABLE spaces DROP COLUMN public_read;
    PRAGMA user_version = 5;
  `);
  fresh.close();

  const migrated = openWorkspaceDatabase(databaseFilename);
  try {
    const version = migrated.connection.prepare("PRAGMA user_version").get() as {
      readonly user_version: number;
    };
    assert.equal(version.user_version, 6);
    const space = migrated.connection
      .prepare("SELECT id, name, public_read FROM spaces")
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...space },
      { id: "space", name: "Existing space", public_read: 0 }
    );
    assert.equal(
      readdirSync(directory).filter((name) => name.includes(".v5-backup-")).length,
      1
    );
  } finally {
    migrated.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Production build migrated and opened a V5 database.");
