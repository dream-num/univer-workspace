import {
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import {
  createLegacyV0Schema,
  seedRichLegacyV0,
} from "../fixtures/legacy-v0.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("automatic product database migration to V6", () => {
  it("backs up a WAL database, migrates all mappings, and is idempotent on restart", () => {
    const { directory, filename, legacy } = legacyDatabase();
    legacy.exec("PRAGMA journal_mode = WAL");
    seedRichLegacyV0(legacy);
    legacy.close();

    const migrated = openWorkspaceDatabase(filename);
    const backup = onlyBackup(directory);
    const backupDatabase = new DatabaseSync(join(directory, backup), {
      readOnly: true,
    });
    expect(backupDatabase.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 0,
    });
    expect(
      backupDatabase
        .prepare("SELECT name FROM catalog_entries ORDER BY id")
        .all()
    ).toHaveLength(4);
    expect(
      backupDatabase
        .prepare("SELECT 1 FROM sqlite_master WHERE name = 'nodes'")
        .get()
    ).toBeUndefined();
    backupDatabase.close();

    expect(migrated.connection.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 6,
    });
    expect(
      migrated.connection.prepare("SELECT id, name FROM nodes ORDER BY id").all()
    ).toHaveLength(4);
    const resource = migrated.connection
      .prepare(
        `SELECT resource.id, resource.node_id, univer.unit_id, univer.unit_type
         FROM resources AS resource
         JOIN univer_resources AS univer ON univer.resource_id = resource.id
         WHERE resource.node_id = 'doc-node'`
      )
      .get() as Record<string, unknown>;
    expect(resource).toMatchObject({
      node_id: "doc-node",
      unit_id: "unit-doc",
      unit_type: "doc",
    });
    expect(
      migrated.connection
        .prepare("SELECT kind FROM resources WHERE id = ?")
        .get(resource.id)
    ).toMatchObject({ kind: "univer" });
    expect(resource.id).not.toBe("doc-node");
    expect(
      migrated.connection.prepare("SELECT * FROM recent_resources").get()
    ).toMatchObject({ user_id: "alice", resource_id: resource.id });
    expect(
      migrated.connection
        .prepare(
          `SELECT resource_id FROM worktree_units
           WHERE worktree_id = 'worktree' AND unit_id = 'unit-doc'`
        )
        .get()
    ).toMatchObject({ resource_id: resource.id });
    const local = migrated.connection
      .prepare(
        `SELECT mapping.resource_id, intent.node_id, intent.target_parent_node_id
         FROM worktree_units AS mapping
         JOIN worktree_node_intents AS intent
           ON intent.worktree_id = mapping.worktree_id
          AND intent.unit_id = mapping.unit_id
         WHERE mapping.unit_id = 'unit-local'`
      )
      .get() as Record<string, unknown>;
    expect(local).toMatchObject({
      node_id: "future-node",
      target_parent_node_id: "root",
    });
    expect(local.resource_id).toEqual(expect.any(String));
    expect(
      migrated.connection
        .prepare("SELECT kind, payload_json, result_json FROM operations WHERE id = 'op-create-file'")
        .get()
    ).toMatchObject({ kind: "create_resource" });
    const createPayload = jsonColumn(
      migrated.connection,
      "op-create-file",
      "payload_json"
    );
    expect(createPayload).toMatchObject({
      nodeId: "doc-node",
      resourceId: resource.id,
      unitId: "unit-doc",
      parentNodeId: "root",
    });
    expect(createPayload).not.toHaveProperty("entryId");
    const localPayload = jsonColumn(
      migrated.connection,
      "op-create-unit",
      "payload_json"
    );
    expect(localPayload).toMatchObject({
      nodeId: "future-node",
      resourceId: local.resource_id,
      targetParentNodeId: "root",
    });
    expect(localPayload).not.toHaveProperty("fileEntryId");
    const migratedOperationJson = migrated.connection
      .prepare("SELECT payload_json, result_json FROM operations")
      .all() as unknown as {
      readonly payload_json: string;
      readonly result_json: string | null;
    }[];
    for (const row of migratedOperationJson) {
      expect(row.payload_json).not.toMatch(
        /"(?:entryId|fileId|fileEntryId|requestedFileId)"/
      );
      expect(row.result_json ?? "").not.toMatch(
        /"(?:entryId|fileId|fileEntryId|requestedFileId)"/
      );
    }
    expect(
      migrated.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('catalog_entries','files','worktree_new_files')"
        )
        .all()
    ).toEqual([]);
    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migrated.connection.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok",
    });
    const stableResourceId = resource.id;
    migrated.close();

    const reopened = openWorkspaceDatabase(filename);
    expect(onlyBackup(directory)).toBe(backup);
    expect(
      reopened.connection
        .prepare("SELECT id FROM resources WHERE node_id = 'doc-node'")
        .get()
    ).toMatchObject({ id: stableResourceId });
    reopened.close();
  });

  it.each([
    ["pending operation", (db: DatabaseSync) => {
      db.prepare("UPDATE operations SET state = 'pending' WHERE id = 'op-create-file'").run();
    }],
    ["failed operation", (db: DatabaseSync) => {
      db.prepare("UPDATE operations SET state = 'failed' WHERE id = 'op-create-file'").run();
    }],
    ["activated local unit without a file mapping", (db: DatabaseSync) => {
      db.prepare("DELETE FROM files WHERE entry_id = 'activated-node'").run();
    }],
    ["local unit without an intent", (db: DatabaseSync) => {
      db.prepare("DELETE FROM worktree_new_files WHERE unit_id = 'unit-local'").run();
    }],
    ["unknown operation JSON shape", (db: DatabaseSync) => {
      db.prepare("UPDATE operations SET payload_json = '{}' WHERE id = 'op-create-file'").run();
    }],
    ["malformed operation JSON", (db: DatabaseSync) => {
      db.prepare("UPDATE operations SET payload_json = '{' WHERE id = 'op-create-file'").run();
    }],
    ["file entry without a file mapping", (db: DatabaseSync) => {
      db.prepare("DELETE FROM files WHERE entry_id = 'trashed-file'").run();
    }],
    ["Trash Batch with a missing root", (db: DatabaseSync) => {
      db.exec("PRAGMA foreign_keys = OFF");
      db.prepare("UPDATE trash_batches SET root_entry_id = 'missing' WHERE id = 'trash'").run();
    }],
    ["cyclic catalog ancestry", (db: DatabaseSync) => {
      db.prepare("UPDATE catalog_entries SET parent_id = 'doc-node' WHERE id = 'root'").run();
    }],
  ])("backs up and leaves V0 untouched for %s", (_name, damage) => {
    const { directory, filename, legacy } = legacyDatabase();
    seedRichLegacyV0(legacy);
    damage(legacy);
    const operationCount = count(legacy, "operations");
    legacy.close();

    expect(() => openWorkspaceDatabase(filename)).toThrow(
      /consistent backup is at/
    );
    expect(onlyBackup(directory)).toContain(".v0-backup-");
    const original = new DatabaseSync(filename);
    expect(original.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 0,
    });
    expect(count(original, "operations")).toBe(operationCount);
    expect(
      original.prepare("SELECT 1 FROM sqlite_master WHERE name = 'catalog_entries'").get()
    ).toBeTruthy();
    expect(
      original.prepare("SELECT 1 FROM sqlite_master WHERE name = 'nodes'").get()
    ).toBeUndefined();
    original.close();
  });

  it("rejects an incomplete V0 fingerprint after creating a backup", () => {
    const { directory, filename, legacy } = legacyDatabase();
    legacy.exec("DROP TABLE operations");
    legacy.close();
    expect(() => openWorkspaceDatabase(filename)).toThrow(/consistent backup is at/);
    expect(onlyBackup(directory)).toContain(".v0-backup-");
  });

  it("creates a fresh V6 database and does not create a backup", () => {
    const directory = temporaryDirectory();
    const filename = join(directory, "workspace.sqlite");
    const database = openWorkspaceDatabase(filename);
    expect(database.connection.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 6,
    });
    database.close();
    expect(backups(directory)).toEqual([]);
  });

  it("backs up V5, preserves Spaces, and defaults public read to off", () => {
    const directory = temporaryDirectory();
    const filename = join(directory, "workspace.sqlite");
    const current = openWorkspaceDatabase(filename);
    current.connection.exec(`
      INSERT INTO users
        (id, username, display_name, created_at, updated_at)
      VALUES ('owner', 'owner', 'Owner', 1, 1);
      INSERT INTO spaces
        (id, type, name, owner_user_id, created_at, updated_at)
      VALUES ('space', 'personal', 'Existing space', 'owner', 1, 1);
      ALTER TABLE spaces DROP COLUMN public_read;
      PRAGMA user_version = 5;
    `);
    current.close();

    const migrated = openWorkspaceDatabase(filename);
    expect(migrated.connection.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 6,
    });
    expect(
      migrated.connection
        .prepare("SELECT id, name, public_read FROM spaces")
        .get()
    ).toEqual({ id: "space", name: "Existing space", public_read: 0 });
    migrated.close();

    const backup = onlyBackup(directory);
    expect(backup).toContain(".v5-backup-");
    const backupDatabase = new DatabaseSync(join(directory, backup), {
      readOnly: true,
    });
    expect(backupDatabase.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 5,
    });
    expect(
      backupDatabase.prepare("PRAGMA table_info(spaces)").all()
    ).not.toContainEqual(expect.objectContaining({ name: "public_read" }));
    backupDatabase.close();

    const reopened = openWorkspaceDatabase(filename);
    reopened.close();
    expect(backups(directory)).toEqual([backup]);
  });

  it("migrates a valid empty V0 database", () => {
    const { directory, filename, legacy } = legacyDatabase();
    legacy.close();
    const migrated = openWorkspaceDatabase(filename);
    expect(count(migrated.connection, "nodes")).toBe(0);
    expect(count(migrated.connection, "resources")).toBe(0);
    expect(
      migrated.connection.prepare("PRAGMA integrity_check").get()
    ).toMatchObject({ integrity_check: "ok" });
    migrated.close();
    expect(backups(directory)).toHaveLength(1);
  });

  it("rejects a current-version database with a mismatched fingerprint", () => {
    const directory = temporaryDirectory();
    const filename = join(directory, "workspace.sqlite");
    const database = new DatabaseSync(filename);
    database.exec("CREATE TABLE nodes (id TEXT); PRAGMA user_version = 6");
    database.close();
    expect(() => openWorkspaceDatabase(filename)).toThrow(
      /V6 fingerprint mismatch/
    );
    expect(backups(directory)).toEqual([]);
  });

  it("does not silently repair a V6 database missing a secondary table", () => {
    const directory = temporaryDirectory();
    const filename = join(directory, "workspace.sqlite");
    const database = openWorkspaceDatabase(filename);
    database.close();
    const damaged = new DatabaseSync(filename);
    damaged.exec("DROP TABLE recent_resources");
    damaged.close();
    expect(() => openWorkspaceDatabase(filename)).toThrow(
      /V6 fingerprint mismatch/
    );
    const unchanged = new DatabaseSync(filename, { readOnly: true });
    expect(
      unchanged
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recent_resources'"
        )
        .get()
    ).toBeUndefined();
    unchanged.close();
    expect(backups(directory)).toEqual([]);
  });

  it("migrates before the full application initializes", async () => {
    const { directory, filename, legacy } = legacyDatabase();
    seedRichLegacyV0(legacy);
    legacy.close();
    const application = createWorkspaceApplication(
      {
        host: "127.0.0.1",
        port: 0,
        databaseFilename: filename,
        collaborationDatabaseFilename: join(
          directory,
          "collaboration.sqlite"
        ),
        secureCookies: false,
        sessionTtlMs: 60_000,
      },
      {
        unitStore: {
          createUnit: async (input) => ({
            unitId: input.unitId,
            headRevision: 1,
          }),
        },
      }
    );
    try {
      expect(application.nodes.get("alice", "doc-node")).toMatchObject({
        node: {
          id: "doc-node",
          resource: { unitType: "doc" },
          hasChildren: false,
        },
      });
      expect(backups(directory)).toHaveLength(1);
    } finally {
      await application.close();
    }
  });

  it("backs up and migrates a rich V1 database exactly once", () => {
    const { directory, filename } = richV1Database();

    const migrated = openWorkspaceDatabase(filename);
    expect(migrated.connection.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 6,
    });
    expect(
      migrated.connection
        .prepare("SELECT id, kind FROM resources ORDER BY id")
        .all()
    ).toEqual([
      { id: "resource-child", kind: "univer" },
      { id: "resource-root", kind: "univer" },
    ]);
    expect(
      migrated.connection
        .prepare("SELECT unit_id, unit_type FROM univer_resources ORDER BY unit_id")
        .all()
    ).toEqual([
      { unit_id: "unit-child", unit_type: "sheet" },
      { unit_id: "unit-root", unit_type: "doc" },
    ]);
    expect(
      migrated.connection.prepare("SELECT kind FROM operations WHERE id = 'operation'").get()
    ).toMatchObject({ kind: "create_resource" });
    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migrated.connection.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok",
    });
    migrated.close();

    const backup = onlyBackup(directory);
    expect(backup).toContain(".v1-backup-");
    const backupDatabase = new DatabaseSync(join(directory, backup), {
      readOnly: true,
    });
    expect(backupDatabase.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 1,
    });
    expect(
      backupDatabase.prepare("PRAGMA table_info(resources)").all()
    ).not.toContainEqual(expect.objectContaining({ name: "kind" }));
    backupDatabase.close();

    const reopened = openWorkspaceDatabase(filename);
    reopened.close();
    expect(backups(directory)).toEqual([backup]);
  });

  it("backs up V4, preserves GitHub identities, and enables Discord", () => {
    const directory = temporaryDirectory();
    const filename = join(directory, "workspace.sqlite");
    const current = openWorkspaceDatabase(filename);
    current.connection.exec(`
      INSERT INTO users (id, username, display_name, created_at, updated_at)
      VALUES ('owner', 'owner', 'Owner', 1, 1);
      INSERT INTO external_identities
        (provider, provider_subject, user_id, provider_username, created_at, updated_at)
      VALUES ('github', 'github-owner', 'owner', 'ownerhub', 1, 1);
    `);
    current.close();

    const v4 = new DatabaseSync(filename);
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

    const migrated = openWorkspaceDatabase(filename);
    expect(migrated.connection.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 6,
    });
    expect(
      migrated.connection.prepare("SELECT * FROM external_identities").get()
    ).toMatchObject({
      provider: "github",
      provider_subject: "github-owner",
      user_id: "owner",
      provider_username: "ownerhub",
    });
    expect(() =>
      migrated.connection.prepare(
        `INSERT INTO external_identities
          (provider, provider_subject, user_id, provider_username, created_at, updated_at)
         VALUES ('discord', 'discord-owner', 'owner', 'ownerdiscord', 2, 2)`
      ).run()
    ).not.toThrow();
    migrated.close();

    const backup = onlyBackup(directory);
    expect(backup).toContain(".v4-backup-");
    const reopened = openWorkspaceDatabase(filename);
    reopened.close();
    expect(backups(directory)).toEqual([backup]);
  });

  it("recognizes the pre-merge Discord V4 and completes both migrations", () => {
    const { directory, filename } = richV3Database();
    const forkedV4 = new DatabaseSync(filename);
    forkedV4.exec(`
      INSERT INTO external_identities
        (provider, provider_subject, user_id, provider_username, created_at, updated_at)
      VALUES ('discord', 'discord-owner', 'owner', 'ownerdiscord', 4, 4);
      PRAGMA user_version = 4;
    `);
    forkedV4.close();

    const migrated = openWorkspaceDatabase(filename);
    expect(migrated.connection.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 6,
    });
    expect(
      migrated.connection.prepare("PRAGMA table_info(univer_asset_uploads)").all()
    ).not.toContainEqual(expect.objectContaining({ name: "detected_media_type" }));
    expect(
      migrated.connection
        .prepare(
          `SELECT provider, provider_subject, user_id, provider_username
           FROM external_identities`
        )
        .get()
    ).toEqual({
      provider: "discord",
      provider_subject: "discord-owner",
      user_id: "owner",
      provider_username: "ownerdiscord",
    });
    migrated.close();
    expect(onlyBackup(directory)).toContain(".v4-backup-");
  });

  it("backs up V3 and preserves published assets and in-flight uploads", () => {
    const { directory, filename } = richV3Database();

    const migrated = openWorkspaceDatabase(filename);
    expect(migrated.connection.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 6,
    });
    expect(
      migrated.connection.prepare("PRAGMA table_info(univer_asset_uploads)").all()
    ).not.toContainEqual(expect.objectContaining({ name: "detected_media_type" }));
    expect(
      migrated.connection
        .prepare("SELECT id, media_type, byte_size, sha256, etag FROM univer_assets")
        .get()
    ).toEqual({
      id: "published-asset",
      media_type: "image/png",
      byte_size: 8,
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      etag: "published-etag",
    });
    expect(
      migrated.connection
        .prepare(
          `SELECT id, declared_media_type, expected_size, received_size,
                  sha256, etag, state
           FROM univer_asset_uploads
           ORDER BY id`
        )
        .all()
    ).toEqual([
      {
        id: "receiving-upload",
        declared_media_type: "image/webp",
        expected_size: 9,
        received_size: null,
        sha256: null,
        etag: null,
        state: "receiving",
      },
      {
        id: "stored-upload",
        declared_media_type: "image/jpeg",
        expected_size: 7,
        received_size: 7,
        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        etag: "stored-etag",
        state: "stored",
      },
    ]);
    expect(count(migrated.connection, "object_deletion_jobs")).toBe(1);
    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    migrated.close();

    const backup = onlyBackup(directory);
    expect(backup).toContain(".v3-backup-");
    const backupDatabase = new DatabaseSync(join(directory, backup), {
      readOnly: true,
    });
    expect(backupDatabase.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 3,
    });
    expect(
      backupDatabase
        .prepare(
          "SELECT detected_media_type FROM univer_asset_uploads WHERE id = 'stored-upload'"
        )
        .get()
    ).toEqual({ detected_media_type: "image/jpeg" });
    backupDatabase.close();

    const reopened = openWorkspaceDatabase(filename);
    reopened.close();
    expect(backups(directory)).toEqual([backup]);
  });

  it("rolls back a failed V3 migration while retaining its verified backup", () => {
    const { directory, filename } = richV3Database();
    const damaged = new DatabaseSync(filename);
    damaged.exec("PRAGMA foreign_keys = OFF");
    damaged.prepare(
      "UPDATE univer_asset_uploads SET actor_user_id = 'missing-user' WHERE id = 'receiving-upload'"
    ).run();
    damaged.close();

    expect(() => openWorkspaceDatabase(filename)).toThrow(
      /V3 to V6 migration failed.*consistent backup is at/
    );
    expect(onlyBackup(directory)).toContain(".v3-backup-");
    const original = new DatabaseSync(filename, { readOnly: true });
    expect(original.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 3,
    });
    expect(
      original.prepare("PRAGMA table_info(univer_asset_uploads)").all()
    ).toContainEqual(expect.objectContaining({ name: "detected_media_type" }));
    expect(count(original, "univer_asset_uploads")).toBe(2);
    original.close();
  });

  it("starts the application after V3 migration and recovers upload sessions", async () => {
    const { directory, filename } = richV3Database();
    const application = createWorkspaceApplication(
      {
        host: "127.0.0.1",
        port: 0,
        databaseFilename: filename,
        collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
        blobDirectory: join(directory, "objects"),
        secureCookies: false,
        sessionTtlMs: 60_000,
      },
      {
        unitStore: {
          createUnit: async (input) => ({
            unitId: input.unitId,
            headRevision: 1,
          }),
        },
      }
    );
    try {
      expect(application.database.connection.prepare("PRAGMA user_version").get()).toMatchObject({
        user_version: 6,
      });
      expect(count(application.database.connection, "univer_asset_uploads")).toBe(0);
      expect(count(application.database.connection, "univer_assets")).toBe(2);
      expect(
        application.database.connection
          .prepare(
            `SELECT media_type, byte_size, sha256, etag
             FROM univer_assets
             WHERE id = 'stored-asset'`
          )
          .get()
      ).toEqual({
        media_type: "image/jpeg",
        byte_size: 7,
        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        etag: "stored-etag",
      });
      expect(count(application.database.connection, "object_deletion_jobs")).toBe(2);
    } finally {
      await application.close();
    }
  });

  it("backs up a rich V2 database and preserves Blob and deletion state", () => {
    const { directory, filename } = richV2Database();

    const migrated = openWorkspaceDatabase(filename);
    expect(migrated.connection.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 6,
    });
    expect(count(migrated.connection, "blob_resources")).toBe(1);
    expect(count(migrated.connection, "blob_upload_sessions")).toBe(1);
    expect(count(migrated.connection, "univer_assets")).toBe(0);
    expect(count(migrated.connection, "univer_asset_uploads")).toBe(0);
    expect(
      migrated.connection
        .prepare(
          `SELECT object_key, reason, attempt_count, lease_owner,
                  lease_expires_at, last_error_code, last_error_message
           FROM object_deletion_jobs
           ORDER BY object_key`
        )
        .all()
    ).toEqual([
      {
        object_key: "00000000-0000-4000-8000-000000000003",
        reason: "blob_resource_deleted",
        attempt_count: 2,
        lease_owner: "worker-a",
        lease_expires_at: 500,
        last_error_code: "DELETE_FAILED",
        last_error_message: "temporary failure",
      },
      {
        object_key: "00000000-0000-4000-8000-000000000004",
        reason: "blob_upload_abandoned",
        attempt_count: 0,
        lease_owner: null,
        lease_expires_at: null,
        last_error_code: null,
        last_error_message: null,
      },
    ]);
    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    migrated.close();

    const backup = onlyBackup(directory);
    expect(backup).toContain(".v2-backup-");
    const backupDatabase = new DatabaseSync(join(directory, backup), {
      readOnly: true,
    });
    expect(backupDatabase.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 2,
    });
    expect(count(backupDatabase, "blob_deletion_jobs")).toBe(2);
    expect(
      backupDatabase
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'object_deletion_jobs'"
        )
        .get()
    ).toBeUndefined();
    backupDatabase.close();

    const reopened = openWorkspaceDatabase(filename);
    reopened.close();
    expect(backups(directory)).toEqual([backup]);
  });

  it("rolls back a failed V2 migration while retaining its verified backup", () => {
    const { directory, filename } = richV2Database();
    const damaged = new DatabaseSync(filename);
    damaged.exec("PRAGMA foreign_keys = OFF");
    damaged.prepare(
      "UPDATE blob_resources SET resource_id = 'missing-resource'"
    ).run();
    damaged.close();

    expect(() => openWorkspaceDatabase(filename)).toThrow(
      /V2 to V6 migration failed.*consistent backup is at/
    );
    expect(onlyBackup(directory)).toContain(".v2-backup-");
    const original = new DatabaseSync(filename, { readOnly: true });
    expect(original.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 2,
    });
    expect(count(original, "blob_deletion_jobs")).toBe(2);
    expect(
      original
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'univer_assets'"
        )
        .get()
    ).toBeUndefined();
    original.close();
  });

  it("rejects a V2 fingerprint mismatch before creating a backup", () => {
    const { directory, filename } = richV2Database();
    const damaged = new DatabaseSync(filename);
    damaged.exec("DROP TABLE blob_upload_sessions");
    damaged.close();

    expect(() => openWorkspaceDatabase(filename)).toThrow(
      /V2 fingerprint mismatch/
    );
    expect(backups(directory)).toEqual([]);
  });

  it("keeps a malformed V1 database untouched when migration validation fails", () => {
    const { directory, filename } = richV1Database();
    const damaged = new DatabaseSync(filename);
    damaged.exec("PRAGMA foreign_keys = OFF");
    damaged.prepare("DELETE FROM univer_resources WHERE resource_id = 'resource-child'").run();
    damaged.close();

    expect(() => openWorkspaceDatabase(filename)).toThrow(/consistent backup is at/);
    expect(onlyBackup(directory)).toContain(".v1-backup-");
    const original = new DatabaseSync(filename, { readOnly: true });
    expect(original.prepare("PRAGMA user_version").get()).toMatchObject({
      user_version: 1,
    });
    expect(
      original.prepare("PRAGMA table_info(resources)").all()
    ).not.toContainEqual(expect.objectContaining({ name: "kind" }));
    expect(
      original
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blob_resources'")
        .get()
    ).toBeUndefined();
    original.close();
  });

  it("rejects a V1 fingerprint mismatch before creating a backup", () => {
    const { directory, filename } = richV1Database();
    const damaged = new DatabaseSync(filename);
    damaged.exec("DROP TABLE recent_resources");
    damaged.close();

    expect(() => openWorkspaceDatabase(filename)).toThrow(/V1 fingerprint mismatch/);
    expect(backups(directory)).toEqual([]);
  });

  it("rejects a V1 database with unexpected Resource columns before backup", () => {
    const { directory, filename } = richV1Database();
    const damaged = new DatabaseSync(filename);
    damaged.exec("ALTER TABLE resources ADD COLUMN legacy_kind TEXT");
    damaged.close();

    expect(() => openWorkspaceDatabase(filename)).toThrow(/V1 fingerprint mismatch/);
    expect(backups(directory)).toEqual([]);
  });

  it("rejects unsupported schema versions without modifying the database", () => {
    const directory = temporaryDirectory();
    const filename = join(directory, "workspace.sqlite");
    const database = new DatabaseSync(filename);
    database.exec("PRAGMA user_version = 7");
    database.close();
    expect(() => openWorkspaceDatabase(filename)).toThrow(
      /Unsupported product database version 7/
    );
    expect(backups(directory)).toEqual([]);
  });
});

function legacyDatabase(): {
  readonly directory: string;
  readonly filename: string;
  readonly legacy: DatabaseSync;
} {
  const directory = temporaryDirectory();
  const filename = join(directory, "workspace.sqlite");
  const legacy = new DatabaseSync(filename);
  createLegacyV0Schema(legacy);
  return { directory, filename, legacy };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "workspace-migration-"));
  directories.push(directory);
  return directory;
}

function richV1Database(): {
  readonly directory: string;
  readonly filename: string;
} {
  const directory = temporaryDirectory();
  const filename = join(directory, "workspace.sqlite");
  const current = openWorkspaceDatabase(filename);
  current.connection.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 1, 1);
    INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at)
    VALUES ('space', 'personal', 'Personal', 'owner', 1, 1);
    INSERT INTO nodes
      (id, space_id, parent_id, name, created_by, created_at, updated_at)
    VALUES
      ('root', 'space', NULL, 'Root', 'owner', 2, 2),
      ('child', 'space', 'root', 'Child', 'owner', 3, 3);
    INSERT INTO resources (id, node_id, kind, created_at, updated_at)
    VALUES
      ('resource-root', 'root', 'univer', 2, 2),
      ('resource-child', 'child', 'univer', 3, 3);
    INSERT INTO univer_resources (resource_id, unit_id, unit_type)
    VALUES
      ('resource-root', 'unit-root', 'doc'),
      ('resource-child', 'unit-child', 'sheet');
    INSERT INTO recent_resources (user_id, resource_id, last_opened_at)
    VALUES ('owner', 'resource-child', 4);
    INSERT INTO operations
      (id, kind, actor_user_id, step, state, payload_json, result_json,
       attempt_count, next_attempt_at, created_at, updated_at, completed_at)
    VALUES
      ('operation', 'create_resource', 'owner', 'completed', 'completed',
       '{"kind":"univer"}', '{"resourceId":"resource-root"}', 1, 5, 1, 5, 5);
  `);
  current.close();

  const database = new DatabaseSync(filename);
  database.exec(`
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
    INSERT INTO resources_v1 (id, node_id, created_at, updated_at)
    SELECT id, node_id, created_at, updated_at FROM resources;
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
  database.close();
  return { directory, filename };
}

function richV3Database(): {
  readonly directory: string;
  readonly filename: string;
} {
  const directory = temporaryDirectory();
  const filename = join(directory, "workspace.sqlite");
  const current = openWorkspaceDatabase(filename);
  current.connection.exec(`
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
    INSERT INTO univer_assets
      (
        id, unit_id, worktree_id, object_key, original_filename, media_type,
        byte_size, sha256, etag, created_by, created_at
      )
    VALUES (
      'published-asset', 'unit', NULL,
      '00000000-0000-4000-8000-000000000020', 'published.png', 'image/png',
      8, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'published-etag', 'owner', 3
    );
    INSERT INTO univer_asset_uploads
      (
        id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
        original_filename, declared_media_type, expected_size, received_size,
        sha256, etag, state, created_at, updated_at, expires_at
      )
    VALUES
      (
        'receiving-upload', 'receiving-asset', 'unit', NULL,
        '00000000-0000-4000-8000-000000000021', 'owner', 'receiving.webp',
        'image/webp', 9, NULL, NULL, NULL, 'receiving', 4, 4, 1000
      ),
      (
        'stored-upload', 'stored-asset', 'unit', NULL,
        '00000000-0000-4000-8000-000000000022', 'owner', 'stored.png',
        NULL, 7, 7,
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'stored-etag', 'stored', 5, 5, 1000
      );
    INSERT INTO object_deletion_jobs
      (id, object_key, reason, next_attempt_at, created_at, updated_at)
    VALUES (
      'delete', '00000000-0000-4000-8000-000000000023',
      'blob_upload_abandoned', 6, 6, 6
    );
  `);
  current.close();

  const database = new DatabaseSync(filename);
  database.exec(`
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
      original_filename, declared_media_type,
      CASE WHEN state = 'stored' THEN 'image/jpeg' ELSE NULL END,
      expected_size, received_size, sha256, etag, state, created_at,
      updated_at, expires_at
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
  database.close();
  return { directory, filename };
}

function richV2Database(): {
  readonly directory: string;
  readonly filename: string;
} {
  const directory = temporaryDirectory();
  const filename = join(directory, "workspace.sqlite");
  const current = openWorkspaceDatabase(filename);
  current.connection.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 1, 1);
    INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at)
    VALUES ('space', 'personal', 'Personal', 'owner', 1, 1);
    INSERT INTO nodes
      (id, space_id, parent_id, name, created_by, created_at, updated_at)
    VALUES ('blob-node', 'space', NULL, 'Blob', 'owner', 2, 2);
    INSERT INTO resources (id, node_id, kind, created_at, updated_at)
    VALUES ('blob-resource', 'blob-node', 'blob', 2, 2);
    INSERT INTO blob_resources
      (
        resource_id, object_key, original_filename, media_type, byte_size,
        sha256, etag, availability, created_at, updated_at
      )
    VALUES (
      'blob-resource', '00000000-0000-4000-8000-000000000001', 'blob.txt',
      'text/plain', 4,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'etag', 'ready', 2, 2
    );
    INSERT INTO operations
      (
        id, kind, actor_user_id, step, state, payload_json, attempt_count,
        next_attempt_at, created_at, updated_at
      )
    VALUES (
      'blob-operation', 'create_blob_resource', 'owner', 'awaiting_upload',
      'pending', '{}', 0, 3, 3, 3
    );
    INSERT INTO blob_upload_sessions
      (
        id, operation_id, actor_user_id, target_space_id, node_id,
        resource_id, object_key, node_name, original_filename, byte_size,
        state, expires_at, created_at, updated_at
      )
    VALUES (
      'blob-upload', 'blob-operation', 'owner', 'space', 'future-node',
      'future-resource', '00000000-0000-4000-8000-000000000002',
      'future.bin', 'future.bin', 5, 'waiting_for_upload', 1000, 3, 3
    );
  `);
  current.close();

  const database = new DatabaseSync(filename);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP TRIGGER univer_asset_uploads_scope_update;
    DROP TRIGGER univer_asset_uploads_trunk_unit_insert;
    DROP TRIGGER univer_assets_trunk_unit_update;
    DROP TRIGGER univer_assets_trunk_unit_insert;
    DROP TABLE univer_asset_uploads;
    DROP TABLE univer_assets;
    DROP TABLE object_deletion_jobs;
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
    INSERT INTO blob_deletion_jobs
      (
        id, object_key, reason, attempt_count, next_attempt_at, lease_owner,
        lease_expires_at, last_error_code, last_error_message,
        created_at, updated_at
      )
    VALUES
      (
        'delete-ready', '00000000-0000-4000-8000-000000000003',
        'resource_deleted', 2, 300, 'worker-a', 500, 'DELETE_FAILED',
        'temporary failure', 3, 4
      ),
      (
        'delete-upload', '00000000-0000-4000-8000-000000000004',
        'upload_abandoned', 0, 301, NULL, NULL, NULL, NULL, 3, 3
      );
    PRAGMA user_version = 2;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  database.close();
  return { directory, filename };
}

function backups(directory: string): string[] {
  return readdirSync(directory).filter((name) => /\.v[0-5]-backup-/.test(name));
}

function onlyBackup(directory: string): string {
  const values = backups(directory);
  expect(values).toHaveLength(1);
  const value = values[0];
  if (!value) throw new Error("Migration backup is missing");
  return value;
}

function count(database: DatabaseSync, table: string): number {
  return (
    database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      readonly count: number;
    }
  ).count;
}

function jsonColumn(
  database: DatabaseSync,
  operationId: string,
  column: "payload_json" | "result_json"
): Record<string, unknown> {
  const row = database
    .prepare(`SELECT ${column} AS value FROM operations WHERE id = ?`)
    .get(operationId) as { readonly value: string };
  return JSON.parse(row.value) as Record<string, unknown>;
}
