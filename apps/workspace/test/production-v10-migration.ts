import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV10Migration } from "./support/v10-migration-checks.js";

verifyV10Migration(openWorkspaceDatabase);
console.log("Production build passed the V10 migration matrix.");
