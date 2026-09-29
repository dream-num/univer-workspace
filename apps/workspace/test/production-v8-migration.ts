import { openWorkspaceDatabase } from "../dist/server/db/initialize.js";
import { verifyV8Migration } from "./support/v8-migration-checks.js";
verifyV8Migration(openWorkspaceDatabase);
console.log("Production build passed the V8 migration matrix.");
