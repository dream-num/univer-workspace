import assert from "node:assert/strict";

export const DROP_V31_SQL = `
DROP INDEX issue_verdicts_issue;
DROP TABLE issue_verdicts;
ALTER TABLE spaces DROP COLUMN accept_after_hours;
`;

export function withoutV31Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return rows.map((row) => {
    const rest = { ...row };
    if (table === "spaces" && "accept_after_hours" in rest) {
      assert.equal(rest.accept_after_hours, null);
      delete rest.accept_after_hours;
    }
    return rest;
  });
}
