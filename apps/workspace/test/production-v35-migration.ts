import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV35Migration } from "./support/v35-migration-checks.js";

verifyV35Migration(openWorkspaceDatabase);
console.log("Production V35 migration checks passed.");
