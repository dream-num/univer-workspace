import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { verifyV17Migration } from "../support/v17-migration-checks.js";

it("preserves V17 data and live sessions, adds the MCP token tables and session columns, rolls back a failed migration and does not migrate twice", () => {
  verifyV17Migration(openWorkspaceDatabase);
});
