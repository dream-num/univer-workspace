import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV19Migration } from "./support/v19-migration-checks.js";
verifyV19Migration(openWorkspaceDatabase);
console.log("Production build passed the V19 migration matrix.");
