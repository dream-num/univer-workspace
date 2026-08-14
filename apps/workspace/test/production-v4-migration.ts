import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createWorkspaceApplication } from "../dist/server/app.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-production-v4-migration-"));
const databaseFilename = join(directory, "workspace.sqlite");
const config = {
  host: "127.0.0.1",
  port: 0,
  databaseFilename,
  collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
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
    INSERT INTO external_identities
      (provider, provider_subject, user_id, provider_username, created_at, updated_at)
    VALUES ('github', 'github-owner', 'owner', 'ownerhub', 1, 1);
  `);
  await fresh.close();

  const v4 = new DatabaseSync(databaseFilename);
  v4.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    ALTER TABLE external_identities RENAME TO external_identities_v5;
    CREATE TABLE external_identities (
      provider TEXT NOT NULL CHECK (provider IN ('github')),
      provider_subject TEXT NOT NULL,
      user_id TEXT NOT NULL,
      provider_username TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, provider_subject),
      UNIQUE (user_id, provider),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO external_identities SELECT * FROM external_identities_v5;
    DROP TABLE external_identities_v5;
    PRAGMA user_version = 4;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  v4.close();

  const migrated = createWorkspaceApplication(config, dependencies);
  try {
    const version = migrated.database.connection
      .prepare("PRAGMA user_version")
      .get() as { readonly user_version: number };
    assert.equal(version.user_version, 6);
    const identity = migrated.database.connection
      .prepare(
        "SELECT provider, provider_subject, user_id FROM external_identities"
      )
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...identity },
      { provider: "github", provider_subject: "github-owner", user_id: "owner" }
    );
    assert.equal(
      readdirSync(directory).filter((name) => name.includes(".v4-backup-")).length,
      1
    );
  } finally {
    await migrated.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Production build migrated and opened a V4 database.");
