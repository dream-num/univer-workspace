import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV31Migration } from "./support/v31-migration-checks.js";

verifyV31Migration(openWorkspaceDatabase);
console.log("Production V31 migration checks passed.");
