import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV33Migration } from "../support/v33-migration-checks.js";

it("lets V33 Operations record a revert with backups, rollback and idempotent restart", () => {
  verifyV33Migration(openWorkspaceDatabase);
});
