import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV34Migration } from "./support/v34-migration-checks.js";

verifyV34Migration(openWorkspaceDatabase);
console.log("Production V34 migration checks passed.");
