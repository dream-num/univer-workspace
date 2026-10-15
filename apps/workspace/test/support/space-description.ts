import assert from "node:assert/strict";

/** V11 backfills `spaces.description` with ''; pre-V11 fixtures compare every other column unchanged. */
export function withoutSpaceDescription(table: string, rows: readonly Record<string, unknown>[]) {
  if (table !== "spaces") return rows;
  return rows.map(({ description, ...rest }) => {
    if (description !== undefined) assert.equal(description, "");
    return rest;
  });
}
