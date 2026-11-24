import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV28Migration } from "./support/v28-migration-checks.js";

verifyV28Migration(openWorkspaceDatabase);
console.log("Production V28 migration checks passed.");
