import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV8Migration } from "../support/v8-migration-checks.js";
it("preserves V8 data and recovery states, rolls back failure, and migrates only once", () => {
  verifyV8Migration(openWorkspaceDatabase);
});
