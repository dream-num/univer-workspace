import assert from "node:assert/strict";

export const DROP_V28_SQL = `
DROP INDEX worktrees_open_fork;
ALTER TABLE worktrees DROP COLUMN fork_id;
DROP TABLE forks;
`;

export function withoutV28Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return rows.map((row) => {
    const rest = { ...row };
    if (table === "worktrees" && "fork_id" in rest) {
      assert.equal(rest.fork_id, null);
      delete rest.fork_id;
    }
    return rest;
  });
}
