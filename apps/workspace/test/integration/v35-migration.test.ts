import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV35Migration } from "../support/v35-migration-checks.js";

it("adds the empty sign-in code table to V35 with backups, rollback and idempotent restart", () => {
  verifyV35Migration(openWorkspaceDatabase);
});
