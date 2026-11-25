import assert from "node:assert/strict";
import { DROP_V34_SQL } from "./v34-downgrade.js";

export const DROP_V33_SQL = `${DROP_V34_SQL}
ALTER TABLE spaces DROP COLUMN landing;
`;

export function withoutV33Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return rows.map((row) => {
    const rest = { ...row };
    if (table === "spaces" && "landing" in rest) {
      assert.equal(rest.landing, "review");
      delete rest.landing;
    }
    return rest;
  });
}
