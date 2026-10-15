import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV9Migration } from "../support/v9-migration-checks.js";

it("preserves V9 data and recovery state, rolls back failed Star migration and does not migrate twice", () => {
  verifyV9Migration(openWorkspaceDatabase);
});
