import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV30Migration } from "./support/v30-migration-checks.js";

verifyV30Migration(openWorkspaceDatabase);
console.log("Production V30 migration checks passed.");
