import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV19Migration } from "../support/v19-migration-checks.js";
it("migrates V19 without losing rows, backs up once, restarts and rolls back failed DDL", () => {
  verifyV19Migration(openWorkspaceDatabase);
});
