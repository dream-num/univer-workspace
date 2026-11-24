import assert from "node:assert/strict";

export const DROP_V30_SQL = `
DROP INDEX worktrees_issue;
ALTER TABLE worktrees DROP COLUMN issue_id;
`;

export function withoutV30Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return rows.map((row) => {
    const rest = { ...row };
    if (table === "worktrees" && "issue_id" in rest) {
      assert.equal(rest.issue_id, null);
      delete rest.issue_id;
    }
    return rest;
  });
}
