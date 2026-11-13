import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV18Migration } from "./support/v18-migration-checks.js";
verifyV18Migration(openWorkspaceDatabase);
console.log("Production build passed the V18 migration matrix.");
