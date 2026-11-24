import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV29Migration } from "./support/v29-migration-checks.js";

verifyV29Migration(openWorkspaceDatabase);
console.log("Production V29 migration checks passed.");
