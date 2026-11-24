import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV30Migration } from "../support/v30-migration-checks.js";

it("adds empty Issue verdicts and an unset acceptance deadline to V30 databases with backups, rollback and idempotent restart", () => {
  verifyV30Migration(openWorkspaceDatabase);
});
