import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV25Migration } from "../support/v25-migration-checks.js";

it("migrates V25 drafts with backups, rollback and idempotent restart", () => {
  verifyV25Migration(openWorkspaceDatabase);
});
