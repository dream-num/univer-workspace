import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV6Migration } from "../support/v6-migration-checks.js";

it("preserves V6 data and upload recovery state, backs up once, and rolls back migration failures", () => {
  verifyV6Migration(openWorkspaceDatabase);
});
