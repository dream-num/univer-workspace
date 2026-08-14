import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

interface LegacyFileRow {
  readonly entry_id: string;
  readonly unit_id: string;
  readonly unit_type: string;
  readonly created_at: number;
  readonly updated_at: number;
}

interface LegacyWorktreeUnitRow {
  readonly worktree_id: string;
  readonly unit_id: string;
  readonly file_entry_id: string;
  readonly source: "trunk" | "worktree";
  readonly ordinal: number;
  readonly added_at: number;
  readonly activated_at: number | null;
}

interface LegacyOperationRow {
  readonly id: string;
  readonly kind: string;
  readonly actor_user_id: string;
  readonly step: string;
  readonly state: string;
  readonly payload_json: string;
  readonly result_json: string | null;
  readonly attempt_count: number;
  readonly next_attempt_at: number;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly lease_owner: string | null;
  readonly lease_expires_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly completed_at: number | null;
}

const REQUIRED_TABLES = [
  "users",
  "spaces",
  "trash_batches",
  "catalog_entries",
  "files",
  "catalog_entry_link_sharing",
  "catalog_entry_grants",
  "recent_files",
  "worktrees",
  "worktree_units",
  "worktree_new_files",
  "operations",
] as const;

export function migrateLegacyV0(database: DatabaseSync): void {
  validateLegacy(database);
  const legacyCounts = {
    nodes: count(database, "catalog_entries"),
    resources: count(database, "files"),
    grants: count(database, "catalog_entry_grants"),
    links: count(database, "catalog_entry_link_sharing"),
    recent: count(database, "recent_files"),
    intents: count(database, "worktree_new_files"),
  };

  const files = database
    .prepare(
      `SELECT file.entry_id, file.unit_id, file.unit_type,
              entry.created_at, entry.updated_at
       FROM files AS file
       JOIN catalog_entries AS entry ON entry.id = file.entry_id`
    )
    .all() as unknown as LegacyFileRow[];
  const resourceByNode = new Map(
    files.map((file) => [file.entry_id, randomUUID()])
  );
  const worktreeUnits = database
    .prepare(
      `SELECT mapping.*, future.activated_at
       FROM worktree_units AS mapping
       LEFT JOIN worktree_new_files AS future
         ON future.worktree_id = mapping.worktree_id
        AND future.unit_id = mapping.unit_id`
    )
    .all() as unknown as LegacyWorktreeUnitRow[];
  const resourceByWorktreeUnit = new Map<string, string>();
  for (const unit of worktreeUnits) {
    const existing = resourceByNode.get(unit.file_entry_id);
    const resourceId = existing ?? randomUUID();
    resourceByWorktreeUnit.set(worktreeUnitKey(unit.worktree_id, unit.unit_id), resourceId);
  }
  const operations = database
    .prepare("SELECT * FROM operations ORDER BY created_at, id")
    .all() as unknown as LegacyOperationRow[];

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    renameLegacyTables(database);
    database.exec(readTargetSchema());
    database.exec(`
      ALTER TABLE spaces ADD COLUMN public_read INTEGER NOT NULL DEFAULT 0
        CHECK (public_read IN (0, 1));
    `);
    copyCoreData(database, files, resourceByNode);
    copyWorktreeData(database, worktreeUnits, resourceByWorktreeUnit);
    copyOperations(database, operations, resourceByNode, resourceByWorktreeUnit);
    dropLegacyTables(database);
    validateMigrated(database, legacyCounts);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function validateLegacy(database: DatabaseSync): void {
  const tableNames = new Set(
    (
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as unknown as { readonly name: string }[]
    ).map((row) => row.name)
  );
  const missing = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Legacy V0 schema is missing tables: ${missing.join(", ")}.`);
  }
  assertIntegrity(database);
  assertNoRows(database, "PRAGMA foreign_key_check", "foreign_key_check");
  assertZero(
    database,
    "SELECT COUNT(*) AS count FROM operations WHERE state <> 'completed'",
    "Legacy operations must all be completed before migration"
  );
  assertZero(
    database,
    `SELECT COUNT(*) AS count
     FROM files AS file
     LEFT JOIN catalog_entries AS entry ON entry.id = file.entry_id
     WHERE entry.id IS NULL OR entry.kind <> 'file'`,
    "Every legacy file mapping must reference a file catalog entry"
  );
  assertZero(
    database,
    `SELECT COUNT(*) AS count
     FROM catalog_entries AS entry
     LEFT JOIN files AS file ON file.entry_id = entry.id
     WHERE (entry.kind = 'folder' AND file.entry_id IS NOT NULL)
        OR (entry.kind = 'file' AND file.entry_id IS NULL)`,
    "Legacy file/folder entries and file mappings must agree"
  );
  assertZero(
    database,
    `SELECT COUNT(*) AS count
     FROM trash_batches AS batch
     LEFT JOIN catalog_entries AS root ON root.id = batch.root_entry_id
     WHERE root.id IS NULL OR root.space_id <> batch.space_id`,
    "Every legacy Trash Batch root must exist in the same Space"
  );
  assertZero(
    database,
    `SELECT COUNT(*) AS count
     FROM worktree_units AS mapping
     LEFT JOIN worktree_new_files AS future
       ON future.worktree_id = mapping.worktree_id
      AND future.unit_id = mapping.unit_id
     LEFT JOIN files AS file ON file.entry_id = mapping.file_entry_id
     WHERE (mapping.source = 'trunk' AND (file.entry_id IS NULL OR future.unit_id IS NOT NULL))
        OR (mapping.source = 'worktree' AND future.unit_id IS NULL)
        OR (mapping.source = 'worktree' AND future.activated_at IS NOT NULL AND file.entry_id IS NULL)
        OR (mapping.source = 'worktree' AND future.activated_at IS NULL AND file.entry_id IS NOT NULL)`,
    "Legacy Worktree mappings are inconsistent"
  );
  assertZero(
    database,
    `SELECT COUNT(*) AS count
     FROM worktree_new_files AS future
     LEFT JOIN worktree_units AS mapping
       ON mapping.worktree_id = future.worktree_id
      AND mapping.unit_id = future.unit_id
     WHERE mapping.unit_id IS NULL OR mapping.source <> 'worktree'`,
    "Every legacy Worktree file intent must reference a local Worktree unit"
  );
}

function renameLegacyTables(database: DatabaseSync): void {
  database.exec(`
    DROP INDEX IF EXISTS catalog_entries_parent;
    DROP INDEX IF EXISTS catalog_entries_trash;
    DROP INDEX IF EXISTS catalog_entry_grants_user;
    DROP INDEX IF EXISTS recent_files_user_opened;
    DROP INDEX IF EXISTS operations_due;
    DROP INDEX IF EXISTS operations_actor;
    ALTER TABLE trash_batches RENAME TO legacy_v0_trash_batches;
    ALTER TABLE catalog_entries RENAME TO legacy_v0_catalog_entries;
    ALTER TABLE files RENAME TO legacy_v0_files;
    ALTER TABLE catalog_entry_link_sharing RENAME TO legacy_v0_catalog_entry_link_sharing;
    ALTER TABLE catalog_entry_grants RENAME TO legacy_v0_catalog_entry_grants;
    ALTER TABLE recent_files RENAME TO legacy_v0_recent_files;
    ALTER TABLE worktree_units RENAME TO legacy_v0_worktree_units;
    ALTER TABLE worktree_new_files RENAME TO legacy_v0_worktree_new_files;
    ALTER TABLE operations RENAME TO legacy_v0_operations;
  `);
}

function copyCoreData(
  database: DatabaseSync,
  files: readonly LegacyFileRow[],
  resourceByNode: ReadonlyMap<string, string>
): void {
  database.exec(`
    INSERT INTO trash_batches
      (id, space_id, root_node_id, created_by, created_at, restored_at)
    SELECT id, space_id, root_entry_id, created_by, created_at, restored_at
    FROM legacy_v0_trash_batches;

    INSERT INTO nodes
      (id, space_id, parent_id, name, created_by, trash_batch_id, created_at, updated_at)
    SELECT id, space_id, parent_id, name, created_by, trash_batch_id, created_at, updated_at
    FROM legacy_v0_catalog_entries;

    INSERT INTO node_link_sharing
      (node_id, enabled, role, created_by, updated_by, created_at, updated_at)
    SELECT entry_id, enabled, role, created_by, updated_by, created_at, updated_at
    FROM legacy_v0_catalog_entry_link_sharing;

    INSERT INTO node_grants
      (node_id, user_id, role, granted_by, created_at, updated_at)
    SELECT entry_id, user_id, role, granted_by, created_at, updated_at
    FROM legacy_v0_catalog_entry_grants;
  `);
  const insertResource = database.prepare(
    `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
     VALUES (?, ?, 'univer', ?, ?)`
  );
  const insertUniver = database.prepare(
    `INSERT INTO univer_resources (resource_id, unit_id, unit_type)
     VALUES (?, ?, ?)`
  );
  for (const file of files) {
    const resourceId = requiredMapping(resourceByNode, file.entry_id);
    insertResource.run(resourceId, file.entry_id, file.created_at, file.updated_at);
    insertUniver.run(resourceId, file.unit_id, file.unit_type);
  }
  const recent = database.prepare(
    "INSERT INTO recent_resources (user_id, resource_id, last_opened_at) VALUES (?, ?, ?)"
  );
  const rows = database
    .prepare("SELECT * FROM legacy_v0_recent_files")
    .all() as unknown as {
      readonly user_id: string;
      readonly file_entry_id: string;
      readonly last_opened_at: number;
    }[];
  for (const row of rows) {
    recent.run(
      row.user_id,
      requiredMapping(resourceByNode, row.file_entry_id),
      row.last_opened_at
    );
  }
}

function copyWorktreeData(
  database: DatabaseSync,
  units: readonly LegacyWorktreeUnitRow[],
  resourceByWorktreeUnit: ReadonlyMap<string, string>
): void {
  const insertUnit = database.prepare(
    `INSERT INTO worktree_units
       (worktree_id, unit_id, resource_id, source, ordinal, added_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const unit of units) {
    insertUnit.run(
      unit.worktree_id,
      unit.unit_id,
      requiredMapping(
        resourceByWorktreeUnit,
        worktreeUnitKey(unit.worktree_id, unit.unit_id)
      ),
      unit.source,
      unit.ordinal,
      unit.added_at
    );
  }
  database.exec(`
    INSERT INTO worktree_node_intents
      (
        worktree_id, unit_id, node_id, target_space_id,
        target_parent_node_id, name, unit_type, created_by,
        activated_at, discarded_at, created_at, updated_at
      )
    SELECT
      future.worktree_id,
      future.unit_id,
      mapping.file_entry_id,
      future.target_space_id,
      future.target_parent_id,
      future.name,
      future.unit_type,
      future.created_by,
      future.activated_at,
      future.discarded_at,
      future.created_at,
      future.updated_at
    FROM legacy_v0_worktree_new_files AS future
    JOIN legacy_v0_worktree_units AS mapping
      ON mapping.worktree_id = future.worktree_id
     AND mapping.unit_id = future.unit_id;
  `);
}

function copyOperations(
  database: DatabaseSync,
  operations: readonly LegacyOperationRow[],
  resourceByNode: ReadonlyMap<string, string>,
  resourceByWorktreeUnit: ReadonlyMap<string, string>
): void {
  const insert = database.prepare(
    `INSERT INTO operations
      (
        id, kind, actor_user_id, step, state, payload_json, result_json,
        attempt_count, next_attempt_at, last_error_code, last_error_message,
        lease_owner, lease_expires_at, created_at, updated_at, completed_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const operation of operations) {
    const transformed = transformOperation(
      operation,
      resourceByNode,
      resourceByWorktreeUnit
    );
    insert.run(
      operation.id,
      transformed.kind,
      operation.actor_user_id,
      operation.step,
      operation.state,
      JSON.stringify(transformed.payload),
      transformed.result === null ? null : JSON.stringify(transformed.result),
      operation.attempt_count,
      operation.next_attempt_at,
      operation.last_error_code,
      operation.last_error_message,
      operation.lease_owner,
      operation.lease_expires_at,
      operation.created_at,
      operation.updated_at,
      operation.completed_at
    );
  }
}

function transformOperation(
  row: LegacyOperationRow,
  resourceByNode: ReadonlyMap<string, string>,
  resourceByWorktreeUnit: ReadonlyMap<string, string>
): {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly result: Record<string, unknown> | null;
} {
  const payload = parseObject(row.payload_json, `${row.id} payload`);
  const result =
    row.result_json === null
      ? null
      : parseObject(row.result_json, `${row.id} result`);
  switch (row.kind) {
    case "create_file": {
      const nodeId = requiredString(payload.entryId, "entryId", row.id);
      const resourceId = requiredMapping(resourceByNode, nodeId);
      const unitId = requiredString(payload.unitId, "unitId", row.id);
      return {
        kind: "create_resource",
        payload: {
          spaceId: payload.spaceId,
          parentNodeId: payload.parentId ?? null,
          name: payload.name,
          unitType: payload.unitType,
          ...(payload.initialData === undefined
            ? {}
            : { initialData: payload.initialData }),
          nodeId,
          resourceId,
          unitId,
        },
        result: { nodeId, resourceId, unitId },
      };
    }
    case "add_worktree_unit": {
      const nodeId = requiredString(payload.fileId, "fileId", row.id);
      return {
        kind: row.kind,
        payload: {
          source: payload.source,
          resourceId: requiredMapping(resourceByNode, nodeId),
          unitId: payload.unitId,
          worktreeId: payload.worktreeId,
        },
        result,
      };
    }
    case "create_worktree_unit": {
      const worktreeId = requiredString(payload.worktreeId, "worktreeId", row.id);
      const unitId = requiredString(payload.unitId, "unitId", row.id);
      const nodeId = requiredString(payload.fileEntryId, "fileEntryId", row.id);
      return {
        kind: row.kind,
        payload: {
          source: payload.source,
          name: payload.name,
          unitType: payload.unitType,
          targetSpaceId: payload.targetSpaceId,
          targetParentNodeId: payload.targetParentId ?? null,
          ...(payload.initialData === undefined
            ? {}
            : { initialData: payload.initialData }),
          worktreeId,
          unitId,
          nodeId,
          resourceId: requiredMapping(
            resourceByWorktreeUnit,
            worktreeUnitKey(worktreeId, unitId)
          ),
        },
        result,
      };
    }
    case "activate_worktree_file": {
      const worktreeId = requiredString(payload.worktreeId, "worktreeId", row.id);
      const unitId = requiredString(payload.unitId, "unitId", row.id);
      const nodeId = requiredString(
        payload.fileEntryId ?? payload.fileId,
        "fileEntryId",
        row.id
      );
      const resourceId = requiredMapping(
        resourceByWorktreeUnit,
        worktreeUnitKey(worktreeId, unitId)
      );
      return {
        kind: "activate_worktree_resource",
        payload: { worktreeId, unitId, nodeId, resourceId },
        result: { worktreeId, unitId, nodeId, resourceId },
      };
    }
    case "create_worktree":
    case "merge_worktree":
    case "discard_worktree":
      return { kind: row.kind, payload, result };
    default:
      throw new Error(`Operation ${row.id} has unknown legacy kind ${row.kind}.`);
  }
}

function dropLegacyTables(database: DatabaseSync): void {
  database.exec(`
    DROP TABLE legacy_v0_recent_files;
    DROP TABLE legacy_v0_catalog_entry_grants;
    DROP TABLE legacy_v0_catalog_entry_link_sharing;
    DROP TABLE legacy_v0_worktree_new_files;
    DROP TABLE legacy_v0_worktree_units;
    DROP TABLE legacy_v0_files;
    DROP TABLE legacy_v0_catalog_entries;
    DROP TABLE legacy_v0_trash_batches;
    DROP TABLE legacy_v0_operations;
  `);
}

function validateMigrated(
  database: DatabaseSync,
  expected: {
    readonly nodes: number;
    readonly resources: number;
    readonly grants: number;
    readonly links: number;
    readonly recent: number;
    readonly intents: number;
  }
): void {
  assertCount(database, "nodes", expected.nodes);
  assertCount(database, "resources", expected.resources);
  assertCount(database, "univer_resources", expected.resources);
  assertCount(database, "node_grants", expected.grants);
  assertCount(database, "node_link_sharing", expected.links);
  assertCount(database, "recent_resources", expected.recent);
  assertCount(database, "worktree_node_intents", expected.intents);
  assertZero(
    database,
    `SELECT COUNT(*) AS count
     FROM resources AS resource
     LEFT JOIN univer_resources AS univer ON univer.resource_id = resource.id
     WHERE univer.resource_id IS NULL`,
    "Every migrated Resource must have a Univer extension"
  );
  assertZero(
    database,
    `WITH RECURSIVE ancestry(origin_id, id, parent_id, space_id, depth) AS (
       SELECT id, id, parent_id, space_id, 0 FROM nodes
       UNION ALL
       SELECT ancestry.origin_id, parent.id, parent.parent_id, parent.space_id, ancestry.depth + 1
       FROM ancestry
       JOIN nodes AS parent ON parent.id = ancestry.parent_id
       WHERE ancestry.depth <= (SELECT COUNT(*) FROM nodes)
     )
     SELECT COUNT(*) AS count
     FROM ancestry
     WHERE depth > (SELECT COUNT(*) FROM nodes)`,
    "Migrated Node ancestry contains a cycle"
  );
  assertZero(
    database,
    `SELECT COUNT(*) AS count
     FROM sqlite_master
     WHERE type = 'table'
       AND name LIKE 'legacy_v0_%'`,
    "Migrated database still contains legacy tables"
  );
  assertNoRows(database, "PRAGMA foreign_key_check", "foreign_key_check");
  assertIntegrity(database);
  const version = database.prepare("PRAGMA user_version").get() as
    | { readonly user_version?: unknown }
    | undefined;
  if (version?.user_version !== 6) {
    throw new Error(
      `Migrated database has user_version ${String(version?.user_version)} instead of 6.`
    );
  }
}

function readTargetSchema(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(`${directory}/../schema.sql`, "utf8");
}

function count(database: DatabaseSync, table: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { readonly count: number };
  return row.count;
}

function assertCount(
  database: DatabaseSync,
  table: string,
  expected: number
): void {
  const actual = count(database, table);
  if (actual !== expected) {
    throw new Error(`${table} row count ${actual} does not match expected ${expected}.`);
  }
}

function assertZero(
  database: DatabaseSync,
  sql: string,
  message: string
): void {
  const row = database.prepare(sql).get() as { readonly count: number };
  if (row.count !== 0) throw new Error(`${message} (${row.count} rows).`);
}

function assertNoRows(
  database: DatabaseSync,
  sql: string,
  name: string
): void {
  const rows = database.prepare(sql).all();
  if (rows.length > 0) {
    throw new Error(`${name} returned ${rows.length} violation(s).`);
  }
}

function assertIntegrity(database: DatabaseSync): void {
  const rows = database.prepare("PRAGMA integrity_check").all() as unknown as {
    readonly integrity_check: string;
  }[];
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
    throw new Error(
      `integrity_check failed: ${rows.map((row) => row.integrity_check).join("; ")}`
    );
  }
}

function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  name: string,
  operationId: string
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Operation ${operationId} is missing ${name}.`);
  }
  return value;
}

function requiredMapping(
  mapping: ReadonlyMap<string, string>,
  key: string
): string {
  const value = mapping.get(key);
  if (!value) throw new Error(`No migration mapping exists for ${key}.`);
  return value;
}

function worktreeUnitKey(worktreeId: string, unitId: string): string {
  return `${worktreeId}\0${unitId}`;
}
