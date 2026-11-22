import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV26Migration } from "../support/v26-migration-checks.js";

it("migrates V26 drafts with backups, rollback and idempotent restart", () => {
  verifyV26Migration(openWorkspaceDatabase);
});
