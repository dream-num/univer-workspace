import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteDatabase } from "./connection.js";
import { prepareCurrentDatabase } from "./migrations/prepare-current-database.js";

export function openWorkspaceDatabase(filename: string): SqliteDatabase {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
    prepareCurrentDatabase(filename);
  }
  return new SqliteDatabase(filename);
}
