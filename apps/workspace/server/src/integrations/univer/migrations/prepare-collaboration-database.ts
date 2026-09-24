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

const TARGET = { core: 2, worktree: 3, history: 2, comment: 1 } as const;

/**
 * Offline startup boundary for SDK 1.0.0. Stop every writer before calling this,
 * before constructing any Service/Adapter. The SDK owns schema migrations; we
 * migrate a consistent copy so a failure in any component leaves the original
 * usable by the previous release. Retire legacy branches after all deployments
 * have upgraded; never invoke this from a request or recovery job.
 */
export async function prepareCollaborationDatabase(
  filename: string,
): Promise<
  | { readonly status: "fresh" | "current" }
  | { readonly status: "migrated"; readonly backupFilename: string }
> {
  if (filename === ":memory:" || !existsSync(filename) || statSync(filename).size === 0) {
    return { status: "fresh" };
  }
  const source = new DatabaseSync(filename);
  let backupFilename: string;
  let versions: Map<string, number>;
  try {
    source.exec("PRAGMA busy_timeout = 5000");
    assertIntegrity(source);
    if (
      !source
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'collaboration_schema_versions'",
        )
        .get()
    ) {
      if (
        source
          .prepare(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name LIKE 'collaboration_%'",
          )
          .get()
      ) {
        throw new Error("Collaboration schema is missing its component versions.");
      }
      return { status: "fresh" };
    }
    versions = new Map(
      source
        .prepare("SELECT component, version FROM collaboration_schema_versions")
        .all()
        .map((row) => [String(row.component), Number(row.version)]),
    );
    for (const [component, target] of Object.entries(TARGET)) {
      const version = versions.get(component);
      if (
        version !== undefined &&
        (!Number.isInteger(version) || version < 1 || version > target)
      ) {
        throw new Error(`Unsupported Collaboration ${component} schema ${version}.`);
      }
    }
    if (
      !Object.entries(TARGET).some(([component, target]) => {
        const version = versions.get(component);
        return version !== undefined && version < target;
      })
    )
      return { status: "current" };

    // Drain WAL before replacing the file; stale WAL pages must never be applied
    // to the migrated database. No application writers may be active here.
    const checkpoint = source.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint?.busy !== 0)
      throw new Error("Collaboration database is busy; stop all writers before upgrading.");
    backupFilename = `${filename}.pre-sdk-1.0.0-${Date.now()}-${randomUUID()}.bak`;
    source.prepare("VACUUM INTO ?").run(backupFilename);
    chmodSync(backupFilename, 0o600);
  } finally {
    source.close();
  }

  const stagedFilename = `${backupFilename}.migrating`;
  try {
    copyFileSync(backupFilename, stagedFilename);
    if (versions.get("core") === 1) await migrateSQLiteCoreV1ToV2({ filename: stagedFilename });
    if (versions.get("worktree") === 1) migrateSQLiteWorktreeV1ToV2({ filename: stagedFilename });
    if ((versions.get("worktree") ?? 3) < 3)
      await migrateSQLiteWorktreeV2ToV3({ filename: stagedFilename });
    // Core and Worktree migrations must read V1 History creation facts first.
    if (versions.get("history") === 1)
      await migrateSQLiteHistoryV1ToV2({ filename: stagedFilename });

    // Public Adapter constructors validate their own schema fingerprints. They
    // also initialize components missing from older deployments on the copy.
    for (const Adapter of [
      SQLiteDatabaseAdapter,
      SQLiteWorktreeDatabaseAdapter,
      SQLiteHistoryDatabaseAdapter,
    ]) {
      await new Adapter({ filename: stagedFilename }).dispose();
    }
    const staged = new DatabaseSync(stagedFilename);
    try {
      assertIntegrity(staged);
      staged.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      staged.close();
    }
    chmodSync(stagedFilename, statSync(filename).mode & 0o777);
    renameSync(stagedFilename, filename);
    return { status: "migrated", backupFilename };
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
