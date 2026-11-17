import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV24Migration } from "../support/v24-migration-checks.js";

it("converges V24 display names an earlier V22 repair left, keeps every other row, backs up once, reruns without change and rolls back", () => {
  verifyV24Migration(openWorkspaceDatabase);
});
