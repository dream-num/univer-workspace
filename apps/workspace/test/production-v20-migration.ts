import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV20Migration } from "./support/v20-migration-checks.js";
verifyV20Migration(openWorkspaceDatabase);
console.log("Production build passed the V20 migration matrix.");
