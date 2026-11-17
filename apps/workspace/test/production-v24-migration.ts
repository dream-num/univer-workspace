import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV24Migration } from "./support/v24-migration-checks.js";
verifyV24Migration(openWorkspaceDatabase);
console.log("Production build passed the V24 migration matrix.");
