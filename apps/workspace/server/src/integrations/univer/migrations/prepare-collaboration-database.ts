import type { UnitCreationFactsReader } from "../../../db/index.js";
import { startupStage, startupStageAsync } from "../../../logging/startup.js";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SQLiteDatabaseAdapter,
  migrateSQLiteCore,
} from "@univerjs-pro/collaboration-database-sqlite";
import {
  SQLiteWorktreeDatabaseAdapter,
  migrateSQLiteWorktree,
} from "@univerjs-pro/collaboration-worktree-database-sqlite";
import {
  SQLiteHistoryDatabaseAdapter,
  migrateSQLiteHistory,
} from "@univerjs-pro/collaboration-history-database-sqlite";
import { readUnitCreationFacts } from "./unit-creation-facts.js";

// Read-only startup preflight. The SDK migration entry points open writable connections.
const TARGET = { core: 4, worktree: 4, history: 2, comment: 1 } as const;

type ComponentVersions = ReadonlyMap<string, number>;

/**
 * Offline startup boundary for the published SDK schema migrations. Stop every writer before
 * calling this. Prepare the product database first and construct collaboration Services/Adapters
 * after migration. The SDK owns schema migrations; we migrate a consistent
 * copy so a failure in any component leaves the original usable by the
 * previous release. Retire legacy branches after all deployments have
 * upgraded; never invoke this from a request or recovery job.
 */
export async function prepareCollaborationDatabase(
  filename: string,
  productFacts: UnitCreationFactsReader,
): Promise<
  | { readonly status: "fresh" | "current" }
  | { readonly status: "migrated"; readonly backupFilename: string }
> {
  if (filename === ":memory:" || !existsSync(filename) || statSync(filename).size === 0) {
    return { status: "fresh" };
  }
  const source = new DatabaseSync(filename);
  try {
    source.exec("PRAGMA busy_timeout = 5000");
    const versions = startupStage("collaboration.versions.read", () =>
      readComponentVersions(source),
    );
    if (!versions) return { status: "fresh" };
    if (
      !Object.entries(TARGET).some(([component, target]) => {
        const version = versions.get(component);
        return version !== undefined && version < target;
      })
    )
      return { status: "current" };

    const journalMode = startupStage("collaboration.lock", () => claimExclusiveAccess(source));
    try {
      startupStage("collaboration.source.validate", () => assertIntegrity(source));
      const backupFilename = await migrateCopy(
        filename,
        source,
        versions,
        productFacts,
        journalMode,
      );
      return { status: "migrated", backupFilename };
    } catch (error) {
      if (journalMode === "wal") source.exec("PRAGMA journal_mode = WAL");
      throw error;
    }
  } finally {
    source.close();
  }
}

function readComponentVersions(source: DatabaseSync): ComponentVersions | undefined {
  if (
    !source
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'collaboration_schema_versions'",
      )
      .get()
  ) {
    if (
      source
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name LIKE 'collaboration_%'")
        .get()
    ) {
      throw new Error("Collaboration schema is missing its component versions.");
    }
    return undefined;
  }
  const versions = new Map(
    source
      .prepare("SELECT component, version FROM collaboration_schema_versions")
      .all()
      .map((row) => [String(row.component), Number(row.version)]),
  );
  for (const [component, target] of Object.entries(TARGET)) {
    const version = versions.get(component);
    if (version !== undefined && (!Number.isInteger(version) || version < 1 || version > target)) {
      throw new Error(`Unsupported Collaboration ${component} schema ${version}.`);
    }
  }
  return versions;
}

/**
 * Holds an exclusive file lock from before the backup until the migrated copy
 * replaces the original, so no other connection can read stale data or commit
 * a write that the replacement would discard. Leaving WAL mode fails while any
 * other connection has the file open. Idle rollback-journal connections hold
 * no lock and cannot be detected; deployment must still stop old instances.
 */
function claimExclusiveAccess(source: DatabaseSync): string {
  source.exec("PRAGMA locking_mode = EXCLUSIVE");
  const journalMode = String(source.prepare("PRAGMA journal_mode").get()?.journal_mode);
  let leftWal = false;
  try {
    if (journalMode === "wal") {
      if (source.prepare("PRAGMA journal_mode = DELETE").get()?.journal_mode !== "delete") {
        throw new Error("Could not leave WAL mode.");
      }
      leftWal = true;
    }
    // In exclusive locking mode the lock is retained after COMMIT until close.
    source.exec("BEGIN EXCLUSIVE; COMMIT");
  } catch (error) {
    if (leftWal) source.exec("PRAGMA journal_mode = WAL");
    throw new Error(
      "Collaboration database is in use; stop every Workspace instance before upgrading.",
      { cause: error },
    );
  }
  return journalMode;
}

async function migrateCopy(
  filename: string,
  source: DatabaseSync,
  versions: ComponentVersions,
  productFacts: UnitCreationFactsReader,
  journalMode: string,
): Promise<string> {
  const creation =
    versions.get("core") === 1 || (versions.get("worktree") ?? TARGET.worktree) < 3
      ? await startupStageAsync("collaboration.creation-facts.read", () =>
          readUnitCreationFacts(source, productFacts, Date.now()),
        )
      : undefined;
  const backupFilename = `${filename}.pre-sdk-migration-${Date.now()}-${randomUUID()}.bak`;
  startupStage("collaboration.backup", () => source.prepare("VACUUM INTO ?").run(backupFilename));
  chmodSync(backupFilename, 0o600);

  const stagingDirectory = `${backupFilename}.migrating`;
  const stagedFilename = join(stagingDirectory, "collaboration.sqlite");
  const options = {
    filename: stagedFilename,
    backupFilename: join(stagingDirectory, "component.bak"),
  };

  async function migrateIfPresent(
    component: "core" | "worktree" | "history",
    migrate: () => Promise<unknown>,
  ) {
    if (!versions.has(component)) return;
    await startupStageAsync(`collaboration.${component}.migrate`, migrate);
    // The whole-file backup is authoritative. Reuse scratch space between SDK backups.
    rmSync(options.backupFilename, { force: true });
  }

  try {
    mkdirSync(stagingDirectory, { mode: 0o700 });
    startupStage("collaboration.staging.copy", () => copyFileSync(backupFilename, stagedFilename));

    // Validate each component on the copy. Opening its adapter also initializes a missing schema.
    await migrateIfPresent("core", () =>
      migrateSQLiteCore({
        ...options,
        ...(creation && { resolveUnitCreation: creation.resolveUnitCreation }),
      }),
    );
    await startupStageAsync("collaboration.adapter.core.validate", () =>
      new SQLiteDatabaseAdapter({ filename: stagedFilename }).dispose(),
    );

    await migrateIfPresent("worktree", () =>
      migrateSQLiteWorktree({
        ...options,
        ...(creation && { resolveUnitCreation: creation.resolveWorktreeUnitCreation }),
      }),
    );
    await startupStageAsync("collaboration.adapter.worktree.validate", () =>
      new SQLiteWorktreeDatabaseAdapter({ filename: stagedFilename }).dispose(),
    );

    // History V1 contains creation facts consumed by the Core and Worktree migrations.
    await migrateIfPresent("history", () => migrateSQLiteHistory(options));
    await startupStageAsync("collaboration.adapter.history.validate", () =>
      new SQLiteHistoryDatabaseAdapter({ filename: stagedFilename }).dispose(),
    );

    const staged = new DatabaseSync(stagedFilename);
    try {
      startupStage("collaboration.staging.validate", () => assertIntegrity(staged));
      if (journalMode === "wal") staged.exec("PRAGMA journal_mode = WAL");
    } finally {
      staged.close();
    }
    chmodSync(stagedFilename, statSync(filename).mode & 0o777);
    startupStage("collaboration.staging.publish", () => renameSync(stagedFilename, filename));
    return backupFilename;
  } catch (error) {
    throw new Error(
      `Collaboration SDK migration failed; the original database is unchanged. Consistent backup: ${backupFilename}`,
      { cause: error },
    );
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

function assertIntegrity(database: DatabaseSync): void {
  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (
    integrity.length !== 1 ||
    integrity[0]?.integrity_check !== "ok" ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) {
    throw new Error("Collaboration database failed integrity or foreign-key validation.");
  }
}
