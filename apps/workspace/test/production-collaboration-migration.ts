import { prepareCollaborationDatabase } from "../dist/server/integrations/univer/migrations/prepare-collaboration-database.js";
import { createCollaborationRuntime } from "../dist/server/integrations/univer/unit-store.js";
import { verifyCollaborationMigration } from "./support/collaboration-migration-checks.js";

await verifyCollaborationMigration(prepareCollaborationDatabase, createCollaborationRuntime);
console.log("Production build passed the Collaboration SDK migration matrix.");
