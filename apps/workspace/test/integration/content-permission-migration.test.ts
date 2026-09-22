import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV7Migration } from "../support/v7-migration-checks.js";
it("preserves V7 data and recovery states, rolls back failure, and migrates only once", () => {
  verifyV7Migration(openWorkspaceDatabase);
});
