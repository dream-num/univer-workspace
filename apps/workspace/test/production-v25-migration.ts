import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV25Migration } from "./support/v25-migration-checks.js";

verifyV25Migration(openWorkspaceDatabase);
console.log("Production V25 migration checks passed.");
