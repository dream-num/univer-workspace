import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV15Migration } from "./support/v15-migration-checks.js";

verifyV15Migration(openWorkspaceDatabase);
console.log("Production build passed the V15 migration matrix.");
