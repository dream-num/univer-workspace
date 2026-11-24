import assert from "node:assert/strict";
import { DROP_V31_SQL, withoutV31Columns } from "./v31-downgrade.js";

export const DROP_V30_SQL = `${DROP_V31_SQL}
DROP INDEX worktrees_issue;
ALTER TABLE worktrees DROP COLUMN issue_id;
`;

export function withoutV30Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return withoutV31Columns(table, rows).map((row) => {
    const rest = { ...row };
    if (table === "worktrees" && "issue_id" in rest) {
      assert.equal(rest.issue_id, null);
      delete rest.issue_id;
    }
    return rest;
  });
}
