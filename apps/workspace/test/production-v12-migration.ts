import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV12Migration } from "./support/v12-migration-checks.js";

verifyV12Migration(openWorkspaceDatabase);
console.log("Production build passed the V12 migration matrix.");
