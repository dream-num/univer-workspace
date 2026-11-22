import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV26Migration } from "./support/v26-migration-checks.js";

verifyV26Migration(openWorkspaceDatabase);
console.log("Production V26 migration checks passed.");
