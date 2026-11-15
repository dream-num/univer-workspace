import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV14Migration } from "./support/v14-migration-checks.js";

verifyV14Migration(openWorkspaceDatabase);
console.log("Production build passed the V14 migration matrix.");
