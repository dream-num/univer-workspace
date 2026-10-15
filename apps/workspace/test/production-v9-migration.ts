import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV9Migration } from "./support/v9-migration-checks.js";

verifyV9Migration(openWorkspaceDatabase);
console.log("Production build passed the V9 migration matrix.");
