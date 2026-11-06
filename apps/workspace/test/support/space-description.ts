import assert from "node:assert/strict";

export function withoutSpaceDescription(table: string, rows: readonly Record<string, unknown>[]) {
  const added: Record<string, unknown> =
    table === "spaces"
      ? { description: "", slug: null }
      : table === "worktrees"
        ? { number: null, created_via: null }
        : table === "users"
          ? { email: null }
          : table === "issues"
            ? { created_via: null }
            : table === "login_sessions"
              ? { write_source: null }
              : {};
  return rows.map((row) => {
    const rest = { ...row };
    for (const [column, value] of Object.entries(added)) {
      if (column in rest) assert.equal(rest[column], value);
      delete rest[column];
    }
    return rest;
  });
}
