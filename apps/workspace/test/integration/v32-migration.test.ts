import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV32Migration } from "../support/v32-migration-checks.js";

it("adds the review landing setting to V32 Spaces with backups, rollback and idempotent restart", () => {
  verifyV32Migration(openWorkspaceDatabase);
});
