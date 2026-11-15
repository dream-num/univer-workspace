import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV20Migration } from "../support/v20-migration-checks.js";
it("migrates V20 without losing rows, backs up once, restarts and rolls back failed DDL", () => {
  verifyV20Migration(openWorkspaceDatabase);
});
