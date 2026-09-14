import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV6Migration } from "./support/v6-migration-checks.js";
verifyV6Migration(openWorkspaceDatabase);
console.log("Production build passed the V6 migration matrix.");
