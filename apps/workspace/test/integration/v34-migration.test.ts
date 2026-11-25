import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV34Migration } from "../support/v34-migration-checks.js";

it("adds the empty source rate event table to V34 with backups, rollback and idempotent restart", () => {
  verifyV34Migration(openWorkspaceDatabase);
});
