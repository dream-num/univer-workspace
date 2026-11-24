import assert from "node:assert/strict";
import { DROP_V29_SQL, withoutV29Columns } from "./v29-downgrade.js";

export const DROP_V28_SQL = `${DROP_V29_SQL}
DROP INDEX worktrees_open_fork;
ALTER TABLE worktrees DROP COLUMN fork_id;
DROP TABLE forks;
`;

export function withoutV28Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return withoutV29Columns(table, rows).map((row) => {
    const rest = { ...row };
    if (table === "worktrees" && "fork_id" in rest) {
      assert.equal(rest.fork_id, null);
      delete rest.fork_id;
    }
    return rest;
  });
}
