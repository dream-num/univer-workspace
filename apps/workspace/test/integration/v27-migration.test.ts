import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV27Migration } from "../support/v27-migration-checks.js";

it("adds forks to V27 databases with backups, rollback and idempotent restart", () => {
  verifyV27Migration(openWorkspaceDatabase);
});
