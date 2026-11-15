import { rmSync } from "node:fs";

/** Used only by the explicit reset command with all database connections closed. */
export function removeSqliteDatabaseFiles(filename: string): void {
  if (filename === ":memory:") return;
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(filename + suffix, { force: true });
  }
}
