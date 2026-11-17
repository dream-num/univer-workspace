import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV23Migration } from "./support/v23-migration-checks.js";

verifyV23Migration(openWorkspaceDatabase);
console.log("Production build passed the V23 migration matrix.");
