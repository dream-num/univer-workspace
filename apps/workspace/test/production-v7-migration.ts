import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV7Migration } from "./support/v7-migration-checks.js";
verifyV7Migration(openWorkspaceDatabase);
console.log("Production build passed the V7 migration matrix.");
