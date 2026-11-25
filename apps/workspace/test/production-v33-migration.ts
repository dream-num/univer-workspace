import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV33Migration } from "./support/v33-migration-checks.js";

verifyV33Migration(openWorkspaceDatabase);
console.log("Production V33 migration checks passed.");
