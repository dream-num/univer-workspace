import { openSqliteCollaborationDatabase } from "../dist/server/integrations/univer/collaboration-database/sqlite/open.js";
import { createSqliteUnitCreationFactsReader } from "../dist/server/db/sqlite/unit-creation-facts.js";
import { prepareCollaborationDatabase } from "../dist/server/integrations/univer/collaboration-database/sqlite/migrations/prepare-collaboration-database.js";
import { createCollaborationRuntime } from "../dist/server/integrations/univer/unit-store.js";
import { verifyCollaborationMigration } from "./support/collaboration-migration-checks.js";

await verifyCollaborationMigration(prepareCollaborationDatabase, createCollaborationRuntime, openSqliteCollaborationDatabase, createSqliteUnitCreationFactsReader);
console.log("Production build passed the Collaboration SDK migration matrix.");
