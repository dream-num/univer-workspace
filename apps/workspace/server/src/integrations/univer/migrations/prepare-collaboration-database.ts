import { startupStage, startupStageAsync } from "../../../logging/startup.js";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  SQLiteDatabaseAdapter,
  migrateSQLiteCoreV1ToV2,
} from "@univerjs-pro/collaboration-database-sqlite";
import {
  SQLiteWorktreeDatabaseAdapter,
  migrateSQLiteWorktreeV1ToV2,
  migrateSQLiteWorktreeV2ToV3,
} from "@univerjs-pro/collaboration-worktree-database-sqlite";
import {
  SQLiteHistoryDatabaseAdapter,
  migrateSQLiteHistoryV1ToV2,
} from "@univerjs-pro/collaboration-history-database-sqlite";
import { readUnitCreationFacts } from "./unit-creation-facts.js";

const TARGET = { core: 2, worktree: 3, history: 2, comment: 1 } as const;

type ComponentVersions = ReadonlyMap<string, number>;

/**
 * Offline startup boundary for SDK 1.0.0. Stop every writer before calling this,
 * before constructing any Service/Adapter, and after the product database is
 * on V7. The SDK owns schema migrations; we migrate a consistent copy so a
 * failure in any component leaves the original usable by the previous release.
 * Retire legacy branches after all deployments have upgraded; never invoke
 * this from a request or recovery job.
 */
export async function prepareCollaborationDatabase(
  filename: string,
  productDatabaseFilename: string,
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
    startupStage("collaboration.source.validate", () => assertIntegrity(source));
    const versions = startupStage("collaboration.versions.read", () => readComponentVersions(source));
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
      const backupFilename = await migrateCopy(
        filename,
        source,
        versions,
        productDatabaseFilename,
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
  productDatabaseFilename: string,
  journalMode: string,
): Promise<string> {
  const creation = startupStage("collaboration.creation-facts.read", () =>
    readUnitCreationFacts(source, productDatabaseFilename, Date.now()),
  );
  const backupFilename = `${filename}.pre-sdk-1.0.0-${Date.now()}-${randomUUID()}.bak`;
  startupStage("collaboration.backup", () => source.prepare("VACUUM INTO ?").run(backupFilename));
  chmodSync(backupFilename, 0o600);

  const stagedFilename = `${backupFilename}.migrating`;
  try {
    startupStage("collaboration.staging.copy", () => copyFileSync(backupFilename, stagedFilename));
    if (versions.get("core") === 1)
      await startupStageAsync("collaboration.core.v1-to-v2", () =>
        migrateSQLiteCoreV1ToV2({
          filename: stagedFilename,
          resolveUnitCreation: creation.resolveUnitCreation,
        }),
      );
    if (versions.get("worktree") === 1)
      startupStage("collaboration.worktree.v1-to-v2", () =>
        migrateSQLiteWorktreeV1ToV2({ filename: stagedFilename }),
      );
    if ((versions.get("worktree") ?? 3) < 3)
      await startupStageAsync("collaboration.worktree.v2-to-v3", () =>
        migrateSQLiteWorktreeV2ToV3({
          filename: stagedFilename,
          resolveUnitCreation: creation.resolveWorktreeUnitCreation,
        }),
      );
    // Core and Worktree migrations must read V1 History creation facts first.
    if (versions.get("history") === 1)
      await startupStageAsync("collaboration.history.v1-to-v2", () =>
        migrateSQLiteHistoryV1ToV2({ filename: stagedFilename }),
      );

    // Public Adapter constructors validate their own schema fingerprints. They
    // also initialize components missing from older deployments on the copy.
    for (const [component, Adapter] of [
      ["core", SQLiteDatabaseAdapter],
      ["worktree", SQLiteWorktreeDatabaseAdapter],
      ["history", SQLiteHistoryDatabaseAdapter],
    ] as const) {
      await startupStageAsync(`collaboration.adapter.${component}.validate`, async () => {
        await new Adapter({ filename: stagedFilename }).dispose();
      });
    }
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
      `Collaboration SDK 1.0.0 migration failed; the original database is unchanged. Consistent backup: ${backupFilename}`,
      { cause: error },
    );
  } finally {
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(`${stagedFilename}${suffix}`, { force: true });
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
