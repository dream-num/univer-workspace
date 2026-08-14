import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateLegacyV0 } from "../legacy-v0/migrate.js";
import { migrateV1ToV2 } from "./v1-to-v2/migrate.js";
import { migrateV2ToV3 } from "./v2-to-v3/migrate.js";
import { migrateV3ToV4 } from "./v3-to-v4/migrate.js";
import { migrateV4ToV5 } from "./v4-to-v5/migrate.js";
import { migrateV5ToV6 } from "./v5-to-v6/migrate.js";

const TARGET_VERSION = 6;
const V1_TABLES = [
  "users",
  "password_credentials",
  "external_identities",
  "login_sessions",
  "spaces",
  "space_members",
  "trash_batches",
  "nodes",
  "resources",
  "univer_resources",
  "node_link_sharing",
  "node_grants",
  "recent_resources",
  "worktrees",
  "worktree_units",
  "worktree_node_intents",
  "operations",
] as const;
const V1_INDEXES = [
  "login_sessions_user",
  "login_sessions_expiry",
  "spaces_personal_owner",
  "space_members_user",
  "nodes_parent",
  "nodes_trash",
  "node_grants_user",
  "recent_resources_user_opened",
  "worktrees_creator",
  "worktrees_team_space",
  "operations_due",
  "operations_actor",
] as const;
const V1_TRIGGERS = [
  "trash_batches_root_node_delete",
  "nodes_parent_insert",
  "nodes_parent_update",
  "space_members_team_only_insert",
  "node_grants_personal_only_insert",
  "node_link_sharing_personal_only_insert",
] as const;
const V2_TABLES = [
  ...V1_TABLES,
  "blob_resources",
  "blob_upload_sessions",
  "blob_deletion_jobs",
] as const;
const V2_INDEXES = [
  ...V1_INDEXES,
  "blob_upload_sessions_actor",
  "blob_upload_sessions_recovery",
  "blob_deletion_jobs_due",
] as const;
const V2_TRIGGERS = [
  ...V1_TRIGGERS,
  "resources_kind_immutable",
  "univer_resources_kind_guard",
  "blob_resources_kind_guard",
] as const;
const V3_TABLES = [
  ...V2_TABLES.filter((name) => name !== "blob_deletion_jobs"),
  "univer_assets",
  "univer_asset_uploads",
  "object_deletion_jobs",
] as const;
const V3_INDEXES = [
  ...V2_INDEXES.filter((name) => name !== "blob_deletion_jobs_due"),
  "univer_assets_trunk_unit",
  "univer_assets_worktree_unit",
  "univer_asset_uploads_recovery",
  "object_deletion_jobs_due",
] as const;
const V3_TRIGGERS = [
  ...V2_TRIGGERS,
  "univer_assets_trunk_unit_insert",
  "univer_assets_trunk_unit_update",
  "univer_asset_uploads_trunk_unit_insert",
  "univer_asset_uploads_scope_update",
] as const;
const V4_TABLES = V3_TABLES;
const V4_INDEXES = V3_INDEXES;
const V4_TRIGGERS = V3_TRIGGERS;
const V5_TABLES = V4_TABLES;
const V5_INDEXES = V4_INDEXES;
const V5_TRIGGERS = V4_TRIGGERS;
const V6_TABLES = V5_TABLES;
const V6_INDEXES = V5_INDEXES;
const V6_TRIGGERS = V5_TRIGGERS;

type DatabasePreparation =
  | { readonly status: "fresh" | "current" }
  | { readonly status: "migrated"; readonly backupFilename: string };

/**
 * Temporary rollout boundary for the supported legacy schemas.
 *
 * Delete this migrations directory and the call from db/initialize.ts after
 * every deployed database is on V6. Business repositories never import it.
 */
export function prepareCurrentDatabase(filename: string): DatabasePreparation {
  if (
    filename === ":memory:" ||
    !existsSync(filename) ||
    statSync(filename).size === 0
  ) {
    return { status: "fresh" };
  }

  const database = new DatabaseSync(filename);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const version = pragmaNumber(database, "user_version");
    if (version === TARGET_VERSION) {
      assertV6Fingerprint(database);
      return { status: "current" };
    }
    if (version === 5) {
      if (hasColumn(database, "spaces", "public_read")) {
        throw new Error("Product database V5 fingerprint mismatch (Space already has public_read)." );
      }
      assertV5Fingerprint(database);
      const backupFilename = createBackup(filename, database, 5);
      try {
        migrateV5ToV6(database);
        assertV6Fingerprint(database);
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (error) {
        throw new Error(
          `Workspace V5 to V6 migration failed. The failing transaction was rolled back and a consistent backup is at ${backupFilename}.`,
          { cause: error }
        );
      }
      return { status: "migrated", backupFilename };
    }
    if (version === 4) {
      const preAssetMigration = hasColumn(
        database,
        "univer_asset_uploads",
        "detected_media_type"
      );
      if (preAssetMigration) {
        assertV3Fingerprint(database);
      } else {
        assertV4Fingerprint(database);
      }
      const backupFilename = createBackup(filename, database, 4);
      try {
        if (preAssetMigration) {
          migrateV3ToV4(database);
        }
        migrateV4ToV5(database);
        migrateV5ToV6(database);
        assertV6Fingerprint(database);
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (error) {
        throw new Error(
          `Workspace V4 to V6 migration failed. The failing transaction was rolled back and a consistent backup is at ${backupFilename}.`,
          { cause: error }
        );
      }
      return { status: "migrated", backupFilename };
    }
    if (version === 3) {
      assertV3Fingerprint(database);
      const backupFilename = createBackup(filename, database, 3);
      try {
        migrateV3ToV4(database);
        migrateV4ToV5(database);
        migrateV5ToV6(database);
        assertV6Fingerprint(database);
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (error) {
        throw new Error(
          `Workspace V3 to V6 migration failed. The failing transaction was rolled back and a consistent backup is at ${backupFilename}.`,
          { cause: error }
        );
      }
      return { status: "migrated", backupFilename };
    }
    if (version === 2) {
      assertV2Fingerprint(database);
      const backupFilename = createBackup(filename, database, 2);
      try {
        migrateV2ToV3(database);
        migrateV3ToV4(database);
        migrateV4ToV5(database);
        migrateV5ToV6(database);
        assertV6Fingerprint(database);
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (error) {
        throw new Error(
          `Workspace V2 to V6 migration failed. The failing transaction was rolled back and a consistent backup is at ${backupFilename}.`,
          { cause: error }
        );
      }
      return { status: "migrated", backupFilename };
    }
    if (version === 1) {
      assertV1Fingerprint(database);
      const backupFilename = createBackup(filename, database, 1);
      try {
        migrateV1ToV2(database);
        migrateV2ToV3(database);
        migrateV3ToV4(database);
        migrateV4ToV5(database);
        migrateV5ToV6(database);
        assertV6Fingerprint(database);
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch (error) {
        throw new Error(
          `Workspace V1 to V6 migration failed. The failing transaction was rolled back and a consistent backup is at ${backupFilename}.`,
          { cause: error }
        );
      }
      return { status: "migrated", backupFilename };
    }
    if (version !== 0) {
      throw new Error(
        `Unsupported product database version ${version}; expected 0, 1, 2, 3, 4, 5, or ${TARGET_VERSION}.`
      );
    }
    if (!hasTable(database, "catalog_entries") && !hasTable(database, "files")) {
      throw new Error(
        "The unversioned product database is not the supported Workspace V0 schema."
      );
    }

    const backupFilename = createBackup(filename, database, 0);

    try {
      migrateLegacyV0(database);
    } catch (error) {
      throw new Error(
        `Legacy Workspace database migration failed. The original V0 database was preserved by the transaction and its consistent backup is at ${backupFilename}.`,
        { cause: error }
      );
    }
    try {
      assertV6Fingerprint(database);
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      throw new Error(
        `Workspace database migration committed, but startup finalization failed. Restore or inspect the consistent V0 backup at ${backupFilename} before retrying.`,
        { cause: error }
      );
    }
    return { status: "migrated", backupFilename };
  } finally {
    database.close();
  }
}

function createBackup(
  filename: string,
  database: DatabaseSync,
  version: 0 | 1 | 2 | 3 | 4 | 5
): string {
  const backupFilename = uniqueBackupFilename(filename, version);
  try {
    database.prepare("VACUUM INTO ?").run(backupFilename);
    verifyBackup(backupFilename, version);
    return backupFilename;
  } catch (error) {
    throw new Error(
      `Could not create and verify a consistent V${version} backup at ${backupFilename}. The product database was not migrated.`,
      { cause: error }
    );
  }
}

function uniqueBackupFilename(filename: string, version: 0 | 1 | 2 | 3 | 4 | 5): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replaceAll("-", "")
    .replace(".", "");
  const directory = dirname(filename);
  const name = basename(filename);
  return join(
    directory,
    `${name}.v${version}-backup-${timestamp}-${randomUUID()}.sqlite`
  );
}

function verifyBackup(filename: string, version: 0 | 1 | 2 | 3 | 4 | 5): void {
  const backup = new DatabaseSync(filename, { readOnly: true });
  try {
    const integrity = backup.prepare("PRAGMA integrity_check").get() as
      | { readonly integrity_check?: unknown }
      | undefined;
    if (integrity?.integrity_check !== "ok") {
      throw new Error(`The V${version} backup failed integrity_check: ${String(integrity?.integrity_check)}`);
    }
    if (pragmaNumber(backup, "user_version") !== version) {
      throw new Error(`The V${version} backup has an unexpected schema version.`);
    }
    if (version === 0) {
      if (!hasTable(backup, "catalog_entries") || !hasTable(backup, "files")) {
        throw new Error("The V0 backup is missing legacy catalog tables.");
      }
    } else if (version === 1) {
      assertV1Fingerprint(backup);
    } else if (version === 2) {
      assertV2Fingerprint(backup);
    } else if (version === 3) {
      assertV3Fingerprint(backup);
    } else if (version === 5) {
      assertV5Fingerprint(backup);
    } else if (
      hasColumn(backup, "univer_asset_uploads", "detected_media_type")
    ) {
      assertV3Fingerprint(backup);
    } else {
      assertV4Fingerprint(backup);
    }
  } finally {
    backup.close();
  }
}

function assertV1Fingerprint(database: DatabaseSync): void {
  const missing = [
    ...V1_TABLES.filter((name) => !hasObject(database, "table", name)),
    ...V1_INDEXES.filter((name) => !hasObject(database, "index", name)),
    ...V1_TRIGGERS.filter((name) => !hasObject(database, "trigger", name)),
  ];
  const legacy = ["catalog_entries", "files", "worktree_new_files"].filter(
    (table) => hasTable(database, table)
  );
  if (missing.length > 0 || legacy.length > 0) {
    throw new Error(
      `Product database V1 fingerprint mismatch (missing: ${missing.join(", ") || "none"}; legacy: ${legacy.join(", ") || "none"}).`
    );
  }
  assertColumns(database, "resources", [
    "id",
    "node_id",
    "created_at",
    "updated_at",
  ], 1);
  assertColumns(database, "operations", [
    "id", "kind", "actor_user_id", "step", "state", "payload_json",
    "result_json", "attempt_count", "next_attempt_at", "last_error_code",
    "last_error_message", "lease_owner", "lease_expires_at", "created_at",
    "updated_at", "completed_at",
  ], 1);
  const operationSql = objectSql(database, "table", "operations");
  if (operationSql.includes("create_blob_resource")) {
    throw new Error("Product database V1 fingerprint mismatch (operations already accepts Blob kind)." );
  }
}

function assertV2Fingerprint(database: DatabaseSync): void {
  const missing = [
    ...V2_TABLES.filter((name) => !hasObject(database, "table", name)),
    ...V2_INDEXES.filter((name) => !hasObject(database, "index", name)),
    ...V2_TRIGGERS.filter((name) => !hasObject(database, "trigger", name)),
  ];
  const legacy = ["catalog_entries", "files", "worktree_new_files"].filter(
    (table) => hasTable(database, table)
  );
  if (missing.length > 0 || legacy.length > 0) {
    throw new Error(
      `Product database V2 fingerprint mismatch (missing: ${missing.join(", ") || "none"}; legacy: ${legacy.join(", ") || "none"}).`
    );
  }
  assertColumns(database, "resources", [
    "id",
    "node_id",
    "kind",
    "created_at",
    "updated_at",
  ], 2);
  assertColumns(database, "blob_resources", [
    "resource_id", "object_key", "original_filename", "media_type",
    "byte_size", "sha256", "etag", "availability", "created_at", "updated_at",
  ], 2);
  assertColumns(database, "blob_upload_sessions", [
    "id", "operation_id", "actor_user_id", "target_space_id",
    "target_parent_node_id", "node_id", "resource_id", "object_key",
    "node_name", "original_filename", "declared_media_type",
    "detected_media_type", "byte_size", "received_size", "sha256", "etag",
    "state", "expires_at", "created_at", "updated_at", "completed_at",
    "last_error_code", "last_error_message",
  ], 2);
  assertColumns(database, "blob_deletion_jobs", [
    "id", "object_key", "reason", "attempt_count", "next_attempt_at",
    "lease_owner", "lease_expires_at", "last_error_code",
    "last_error_message", "created_at", "updated_at",
  ], 2);
  if (!objectSql(database, "table", "operations").includes("create_blob_resource")) {
    throw new Error("Product database V2 fingerprint mismatch (operations lacks Blob kind)." );
  }
}

function assertV3Fingerprint(database: DatabaseSync): void {
  const missing = [
    ...V3_TABLES.filter((name) => !hasObject(database, "table", name)),
    ...V3_INDEXES.filter((name) => !hasObject(database, "index", name)),
    ...V3_TRIGGERS.filter((name) => !hasObject(database, "trigger", name)),
  ];
  const legacy = [
    "catalog_entries",
    "files",
    "worktree_new_files",
    "blob_deletion_jobs",
  ].filter((table) => hasTable(database, table));
  if (missing.length > 0 || legacy.length > 0) {
    throw new Error(
      `Product database V3 fingerprint mismatch (missing: ${missing.join(", ") || "none"}; legacy: ${legacy.join(", ") || "none"}).`
    );
  }
  assertColumns(database, "univer_assets", [
    "id", "unit_id", "worktree_id", "object_key", "original_filename",
    "media_type", "byte_size", "sha256", "etag", "created_by", "created_at",
  ], 3);
  assertColumns(database, "univer_asset_uploads", [
    "id", "asset_id", "unit_id", "worktree_id", "object_key",
    "actor_user_id", "original_filename", "declared_media_type",
    "detected_media_type", "expected_size", "received_size", "sha256",
    "etag", "state", "created_at", "updated_at", "expires_at",
  ], 3);
  assertColumns(database, "object_deletion_jobs", [
    "id", "object_key", "reason", "attempt_count", "next_attempt_at",
    "lease_owner", "lease_expires_at", "last_error_code",
    "last_error_message", "created_at", "updated_at",
  ], 3);
  const deletionJobsSql = objectSql(database, "table", "object_deletion_jobs");
  if (
    ![
      "blob_resource_deleted",
      "blob_upload_abandoned",
      "univer_unit_deleted",
      "univer_asset_upload_abandoned",
      "worktree_asset_expired",
    ].every((reason) => deletionJobsSql.includes(reason))
  ) {
    throw new Error("Product database V3 fingerprint mismatch (Object Deletion reasons differ)." );
  }
}

function assertV4Fingerprint(database: DatabaseSync): void {
  const missing = [
    ...V4_TABLES.filter((name) => !hasObject(database, "table", name)),
    ...V4_INDEXES.filter((name) => !hasObject(database, "index", name)),
    ...V4_TRIGGERS.filter((name) => !hasObject(database, "trigger", name)),
  ];
  const legacy = [
    "catalog_entries",
    "files",
    "worktree_new_files",
    "blob_deletion_jobs",
    "univer_asset_uploads_v3",
  ].filter((table) => hasTable(database, table));
  if (missing.length > 0 || legacy.length > 0) {
    throw new Error(
      `Product database V4 fingerprint mismatch (missing: ${missing.join(", ") || "none"}; legacy: ${legacy.join(", ") || "none"}).`
    );
  }
  assertColumns(database, "univer_assets", [
    "id", "unit_id", "worktree_id", "object_key", "original_filename",
    "media_type", "byte_size", "sha256", "etag", "created_by", "created_at",
  ], 4);
  assertColumns(database, "univer_asset_uploads", [
    "id", "asset_id", "unit_id", "worktree_id", "object_key",
    "actor_user_id", "original_filename", "declared_media_type",
    "expected_size", "received_size", "sha256", "etag", "state",
    "created_at", "updated_at", "expires_at",
  ], 4);
  assertColumns(database, "object_deletion_jobs", [
    "id", "object_key", "reason", "attempt_count", "next_attempt_at",
    "lease_owner", "lease_expires_at", "last_error_code",
    "last_error_message", "created_at", "updated_at",
  ], 4);
  const deletionJobsSql = objectSql(database, "table", "object_deletion_jobs");
  if (
    ![
      "blob_resource_deleted",
      "blob_upload_abandoned",
      "univer_unit_deleted",
      "univer_asset_upload_abandoned",
      "worktree_asset_expired",
    ].every((reason) => deletionJobsSql.includes(reason))
  ) {
    throw new Error("Product database V4 fingerprint mismatch (Object Deletion reasons differ)." );
  }
}

function assertV5Fingerprint(database: DatabaseSync): void {
  const missing = [
    ...V5_TABLES.filter((name) => !hasObject(database, "table", name)),
    ...V5_INDEXES.filter((name) => !hasObject(database, "index", name)),
    ...V5_TRIGGERS.filter((name) => !hasObject(database, "trigger", name)),
  ];
  const legacy = [
    "catalog_entries",
    "files",
    "worktree_new_files",
    "blob_deletion_jobs",
    "univer_asset_uploads_v3",
    "external_identities_v4",
  ].filter((table) => hasTable(database, table));
  if (missing.length > 0 || legacy.length > 0) {
    throw new Error(
      `Product database V5 fingerprint mismatch (missing: ${missing.join(", ") || "none"}; legacy: ${legacy.join(", ") || "none"}).`
    );
  }
  const identitySql = objectSql(database, "table", "external_identities");
  if (!identitySql.includes("github") || !identitySql.includes("discord")) {
    throw new Error("Product database V5 fingerprint mismatch (External Identity Providers differ).");
  }
  assertColumns(database, "external_identities", [
    "provider", "provider_subject", "user_id", "provider_username",
    "created_at", "updated_at",
  ], 5);
  assertColumns(database, "univer_assets", [
    "id", "unit_id", "worktree_id", "object_key", "original_filename",
    "media_type", "byte_size", "sha256", "etag", "created_by", "created_at",
  ], 5);
  assertColumns(database, "univer_asset_uploads", [
    "id", "asset_id", "unit_id", "worktree_id", "object_key",
    "actor_user_id", "original_filename", "declared_media_type",
    "expected_size", "received_size", "sha256", "etag", "state",
    "created_at", "updated_at", "expires_at",
  ], 5);
  assertColumns(database, "object_deletion_jobs", [
    "id", "object_key", "reason", "attempt_count", "next_attempt_at",
    "lease_owner", "lease_expires_at", "last_error_code",
    "last_error_message", "created_at", "updated_at",
  ], 5);
  const deletionJobsSql = objectSql(database, "table", "object_deletion_jobs");
  if (
    ![
      "blob_resource_deleted",
      "blob_upload_abandoned",
      "univer_unit_deleted",
      "univer_asset_upload_abandoned",
      "worktree_asset_expired",
    ].every((reason) => deletionJobsSql.includes(reason))
  ) {
    throw new Error("Product database V5 fingerprint mismatch (Object Deletion reasons differ)." );
  }
}

function assertV6Fingerprint(database: DatabaseSync): void {
  const missing = [
    ...V6_TABLES.filter((name) => !hasObject(database, "table", name)),
    ...V6_INDEXES.filter((name) => !hasObject(database, "index", name)),
    ...V6_TRIGGERS.filter((name) => !hasObject(database, "trigger", name)),
  ];
  if (missing.length > 0) {
    throw new Error(
      `Product database V6 fingerprint mismatch (missing: ${missing.join(", ")}).`
    );
  }
  assertV5Fingerprint(database);
  assertColumns(database, "spaces", [
    "id", "type", "name", "owner_user_id", "created_at", "updated_at",
    "public_read",
  ], 6);
  const spacesSql = objectSql(database, "table", "spaces");
  if (!spacesSql.includes("public_read") || !spacesSql.includes("public_read IN (0, 1)")) {
    throw new Error("Product database V6 fingerprint mismatch (Space public-read policy differs).");
  }
}

function assertColumns(
  database: DatabaseSync,
  table: string,
  expected: readonly string[],
  version: 1 | 2 | 3 | 4 | 5 | 6
): void {
  const actual = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    readonly name: string;
  }>;
  const names = actual.map((column) => column.name);
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(
      `Product database V${version} fingerprint mismatch (${table} columns: ${names.join(", ")}).`
    );
  }
}

function objectSql(
  database: DatabaseSync,
  type: "table" | "index" | "trigger",
  name: string
): string {
  const row = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = ? AND name = ?"
  ).get(type, name) as { readonly sql: string | null } | undefined;
  return row?.sql ?? "";
}

function pragmaNumber(database: DatabaseSync, name: string): number {
  const row = database.prepare(`PRAGMA ${name}`).get() as
    | Record<string, unknown>
    | undefined;
  const value = row?.[name];
  if (typeof value !== "number") {
    throw new Error(`PRAGMA ${name} did not return a number.`);
  }
  return value;
}

function hasTable(database: DatabaseSync, name: string): boolean {
  return hasObject(database, "table", name);
}

function hasColumn(
  database: DatabaseSync,
  table: string,
  column: string
): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    readonly name: string;
  }>;
  return columns.some((candidate) => candidate.name === column);
}

function hasObject(
  database: DatabaseSync,
  type: "table" | "index" | "trigger",
  name: string
): boolean {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?"
      )
      .get(type, name)
  );
}
