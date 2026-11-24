import assert from "node:assert/strict";
import { DROP_V30_SQL, withoutV30Columns } from "./v30-downgrade.js";

export const DROP_V29_SQL = `${DROP_V30_SQL}
ALTER TABLE spaces DROP COLUMN proposals;
`;

export function withoutV29Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return withoutV30Columns(table, rows).map((row) => {
    const rest = { ...row };
    if (table === "spaces" && "proposals" in rest) {
      assert.equal(rest.proposals, "members");
      delete rest.proposals;
    }
    return rest;
  });
}
