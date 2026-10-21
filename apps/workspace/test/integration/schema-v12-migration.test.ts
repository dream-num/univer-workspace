import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV11Migration } from "../support/v11-migration-checks.js";

it("preserves V11 data, enforces slug and number constraints, rolls back a failed migration and does not migrate twice", () => {
  verifyV11Migration(openWorkspaceDatabase);
});
