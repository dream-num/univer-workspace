import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV11Migration } from "./support/v11-migration-checks.js";

verifyV11Migration(openWorkspaceDatabase);
console.log("Production build passed the V11 migration matrix.");
