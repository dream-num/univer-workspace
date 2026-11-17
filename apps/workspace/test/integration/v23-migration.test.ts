import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV23Migration } from "../support/v23-migration-checks.js";

it("migrates V23 without losing rows, backs up once, restarts and rolls back failed DDL", () => {
  verifyV23Migration(openWorkspaceDatabase);
});
