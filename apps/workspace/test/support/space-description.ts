import assert from "node:assert/strict";

/**
 * V11 backfills `spaces.description` with ''; V12 adds `spaces.slug` and
 * `worktrees.number` as NULL; V14 adds `users.email` as NULL. Pre-V12 and pre-V14
 * fixtures compare every other column unchanged.
 */
export function withoutSpaceDescription(table: string, rows: readonly Record<string, unknown>[]) {
  const added: Record<string, unknown> =
    table === "spaces"
      ? { description: "", slug: null }
      : table === "worktrees"
        ? { number: null }
        : table === "users"
          ? { email: null }
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
