import { copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertV24Fingerprint } from "../db/sqlite/migrations/prepare-current-database.js";
import { createSqliteUnitCreationFactsReader } from "../db/sqlite/unit-creation-facts.js";
import { openSqliteCollaborationDatabase } from "../integrations/univer/collaboration-database/sqlite/open.js";

// A maintenance window is still required. Detect changes to either source while copying or importing.
async function fileStamp(path: string): Promise<string | null> {
  try {
    const { ino, size, mtimeNs } = await stat(path, { bigint: true });
    return `${ino}:${size}:${mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Opening SQLite in WAL mode can create or modify its shared-memory file even for a reader.
// With writers stopped, copy the durable files and let SQLite reconstruct the index in scratch.
async function copyStoppedDatabase(source: string, destination: string): Promise<void> {
  const info = await stat(source);
  if (!info.isFile() || !info.size) throw new Error(`Missing or empty SQLite database: ${source}`);
  await copyFile(source, destination);
  for (const suffix of ["-wal", "-journal"]) {
    try {
      await copyFile(source + suffix, destination + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function checkIntegrity(db: DatabaseSync): void {
  if (
    db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").get()
  ) {
    throw new Error("SQLite source failed integrity or foreign key checks");
  }
}

export async function prepareSource(
  directory: string,
  productFile: string,
  collaborationFile: string,
  resources: AsyncDisposableStack,
) {
  const durableFiles = [productFile, collaborationFile].flatMap((path) => [
    path,
    path + "-wal",
    path + "-journal",
  ]);
  const before = await Promise.all(durableFiles.map(fileStamp));
  async function checkSourceStopped() {
    const after = await Promise.all(durableFiles.map(fileStamp));
    if (after.some((value, index) => value !== before[index])) {
      throw new Error("SQLite source changed during migration. Stop all writers before retrying.");
    }
  }

  const productPath = join(directory, "product.sqlite");
  const collaborationPath = join(directory, "collaboration.sqlite");
  await copyStoppedDatabase(productFile, productPath);
  const product = new DatabaseSync(productPath);
  resources.defer(() => product.close());
  const version = product.prepare("PRAGMA user_version").get()?.user_version;
  if (version !== 24) {
    throw new Error(
      `Expected a V24 SQLite product database, got V${version}. For older versions, upgrade on SQLite before migrating.`,
    );
  }
  assertV24Fingerprint(product);
  checkIntegrity(product);

  await copyStoppedDatabase(collaborationFile, collaborationPath);
  await checkSourceStopped();
  const preflight = new DatabaseSync(collaborationPath);
  try {
    checkIntegrity(preflight);
    if (
      preflight.prepare("SELECT 1 FROM sqlite_schema WHERE name='collaboration_resources'").get() &&
      preflight.prepare("SELECT 1 FROM collaboration_resources LIMIT 1").get()
    ) {
      throw new Error("Cannot represent legacy collaboration_resources in PostgreSQL");
    }
    if (
      !preflight
        .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'collaboration_schema_versions'")
        .get()
    ) {
      throw new Error("Expected a Workspace collaboration SQLite database");
    }
  } finally {
    preflight.close();
  }
  const adapters = await openSqliteCollaborationDatabase(
    collaborationPath,
    createSqliteUnitCreationFactsReader(product),
  );
  resources.defer(() => adapters.close());
  // SDK migrations can replace the staging file. Open this reader after they finish.
  const collaboration = new DatabaseSync(collaborationPath, { readOnly: true });
  resources.defer(() => collaboration.close());
  checkIntegrity(collaboration);
  return {
    product,
    collaboration,
    worktree: adapters.worktree,
    checkSourceStopped,
  };
}

export type Source = Awaited<ReturnType<typeof prepareSource>>;
