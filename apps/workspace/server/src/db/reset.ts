import { rmSync } from "node:fs";
import { loadConfig } from "../config.js";
import { removeSqliteDatabaseFiles } from "../integrations/sqlite/files.js";
import { resetProductDatabase } from "./index.js";

const config = loadConfig();
removeSqliteDatabaseFiles(config.collaborationDatabaseFilename);
if (config.blobDirectory) {
  rmSync(config.blobDirectory, { recursive: true, force: true });
}
await resetProductDatabase(config.productDatabase);
console.info("Created product database.");
