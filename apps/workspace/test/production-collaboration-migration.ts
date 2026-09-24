import { prepareCollaborationDatabase } from "../dist/server/integrations/univer/migrations/prepare-collaboration-database.js";
import { createCollaborationRuntime } from "../dist/server/integrations/univer/unit-store.js";
import { verifyCollaborationMigration } from "./support/collaboration-migration-checks.js";

await verifyCollaborationMigration(prepareCollaborationDatabase, createCollaborationRuntime);
console.log("Production build passed the SDK 1.0.0 Collaboration migration matrix.");
