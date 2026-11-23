import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV27Migration } from "./support/v27-migration-checks.js";

verifyV27Migration(openWorkspaceDatabase);
console.log("Production V27 migration checks passed.");
