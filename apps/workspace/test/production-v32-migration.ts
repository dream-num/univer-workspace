import { openWorkspaceDatabase } from "../dist/server/db/sqlite/initialize.js";
import { verifyV32Migration } from "./support/v32-migration-checks.js";

verifyV32Migration(openWorkspaceDatabase);
console.log("Production V32 migration checks passed.");
