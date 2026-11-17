import { it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { verifyV21Migration } from "../support/v21-migration-checks.js";
it("repairs V21 display names and default Personal Space names, backs up once, reruns without change and rolls back", () => {
  verifyV21Migration(openWorkspaceDatabase);
});
