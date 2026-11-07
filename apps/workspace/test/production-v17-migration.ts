import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV17Migration } from "./support/v17-migration-checks.js";

verifyV17Migration(openWorkspaceDatabase);
console.log("Production build passed the V17 migration matrix.");
