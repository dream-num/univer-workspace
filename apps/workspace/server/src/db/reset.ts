import { existsSync, rmSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { openWorkspaceDatabase } from "./initialize.js";

const config = loadConfig();
const filenames = [
  resolve(config.databaseFilename),
  resolve(config.collaborationDatabaseFilename),
];
for (const filename of filenames) {
  for (const candidate of [filename, `${filename}-shm`, `${filename}-wal`]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}
if (config.blobDirectory) {
  rmSync(resolve(config.blobDirectory), { recursive: true, force: true });
}

openWorkspaceDatabase(config.databaseFilename).close();
console.info(`Created product database at ${config.databaseFilename}`);
