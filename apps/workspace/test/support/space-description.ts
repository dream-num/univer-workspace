import assert from "node:assert/strict";
import { withoutV24Columns } from "./v24-downgrade.js";

export function withoutSpaceDescription(table: string, rows: readonly Record<string, unknown>[]) {
  const added: Record<string, unknown> =
    table === "spaces"
      ? { description: "", slug: null }
      : table === "worktrees"
        ? { number: null, created_via: null }
        : table === "users"
          ? { email: null, kind: "human" }
          : table === "issues"
            ? { created_via: null }
            : table === "login_sessions"
              ? { write_source: null }
              : {};
  return withoutV24Columns(table, rows).map((rest) => {
    for (const [column, value] of Object.entries(added)) {
      if (column in rest) assert.equal(rest[column], value);
      delete rest[column];
    }
    return rest;
  });
}
