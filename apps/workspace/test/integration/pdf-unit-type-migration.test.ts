import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV16Migration } from "../support/v16-migration-checks.js";

it("preserves V16 data and recovery state, admits the PDF Unit type, rolls back a failed migration and does not migrate twice", () => {
  verifyV16Migration(openWorkspaceDatabase);
});
