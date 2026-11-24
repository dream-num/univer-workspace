import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV28Migration } from "../support/v28-migration-checks.js";

it("adds the proposals setting to V28 databases with backups, rollback and idempotent restart", () => {
  verifyV28Migration(openWorkspaceDatabase);
});
