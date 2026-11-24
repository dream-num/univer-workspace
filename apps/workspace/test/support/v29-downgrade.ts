import assert from "node:assert/strict";

export const DROP_V29_SQL = `
ALTER TABLE spaces DROP COLUMN proposals;
`;

export function withoutV29Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return rows.map((row) => {
    const rest = { ...row };
    if (table === "spaces" && "proposals" in rest) {
      assert.equal(rest.proposals, "members");
      delete rest.proposals;
    }
    return rest;
  });
}
