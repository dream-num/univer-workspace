import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV31Migration } from "../support/v31-migration-checks.js";

it("adds an empty check result table to V31 databases with backups, rollback and idempotent restart", () => {
  verifyV31Migration(openWorkspaceDatabase);
});
