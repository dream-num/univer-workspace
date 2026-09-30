import { it } from "vitest";
import { prepareCollaborationDatabase } from "../../server/src/integrations/univer/migrations/prepare-collaboration-database.js";
import { createCollaborationRuntime } from "../../server/src/integrations/univer/unit-store.js";
import { verifyCollaborationMigration } from "../support/collaboration-migration-checks.js";

// The fixture migrates a full database copy with an app startup inside one
// test; 5 s machine-speed variance already exceeded Vitest's default locally.
it("migrates RC collaboration data atomically and preserves history and pending work", { timeout: 30_000 }, async () => {
  await verifyCollaborationMigration(prepareCollaborationDatabase, createCollaborationRuntime);
});
