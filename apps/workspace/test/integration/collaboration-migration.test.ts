import { it } from "vitest";
import { prepareCollaborationDatabase } from "../../server/src/integrations/univer/migrations/prepare-collaboration-database.js";
import { createCollaborationRuntime } from "../../server/src/integrations/univer/unit-store.js";
import { verifyCollaborationMigration } from "../support/collaboration-migration-checks.js";

it("migrates RC collaboration data atomically and preserves history and pending work", async () => {
  await verifyCollaborationMigration(prepareCollaborationDatabase, createCollaborationRuntime);
});
