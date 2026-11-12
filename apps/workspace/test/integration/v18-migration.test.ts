import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV18Migration } from "../support/v18-migration-checks.js";
it("migrates V18 without losing rows, backs up once, restarts and rolls back failed DDL", () => {
  verifyV18Migration(openWorkspaceDatabase);
});
