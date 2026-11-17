import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV22Migration } from "./support/v22-migration-checks.js";
verifyV22Migration(openWorkspaceDatabase);
console.log("Production build passed the V22 migration matrix.");
