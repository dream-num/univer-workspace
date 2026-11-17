import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV22Migration } from "../support/v22-migration-checks.js";

it("migrates V22 without losing rows, backs up once, restarts and rolls back failed DDL", () => {
  verifyV22Migration(openWorkspaceDatabase);
});
