import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV10Migration } from "../support/v10-migration-checks.js";

it("preserves V10 data, rolls back a failed description migration and does not migrate twice", () => {
  verifyV10Migration(openWorkspaceDatabase);
});
