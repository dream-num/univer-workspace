import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV29Migration } from "../support/v29-migration-checks.js";

it("adds an empty Issue link to V29 Worktrees with backups, rollback and idempotent restart", () => {
  verifyV29Migration(openWorkspaceDatabase);
});
