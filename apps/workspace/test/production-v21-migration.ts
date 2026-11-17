import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV21Migration } from "./support/v21-migration-checks.js";
verifyV21Migration(openWorkspaceDatabase);
console.log("Production build passed the V21 migration matrix.");
