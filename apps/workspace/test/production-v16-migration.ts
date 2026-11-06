import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV16Migration } from "./support/v16-migration-checks.js";

verifyV16Migration(openWorkspaceDatabase);
console.log("Production build passed the V16 migration matrix.");
