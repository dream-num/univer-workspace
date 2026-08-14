import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { WorkspaceDatabase } from "./database.js";
import { prepareCurrentDatabase } from "./migrations/prepare-current-database.js";

export function openWorkspaceDatabase(filename: string): WorkspaceDatabase {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
    prepareCurrentDatabase(filename);
  }
  return new WorkspaceDatabase(filename);
}
