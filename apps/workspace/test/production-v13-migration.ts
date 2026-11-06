import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV13Migration } from "./support/v13-migration-checks.js";

verifyV13Migration(openWorkspaceDatabase);
console.log("Production build passed the V13 migration matrix.");
