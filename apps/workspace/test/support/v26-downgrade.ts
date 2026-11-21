import assert from "node:assert/strict";

export const DROP_V26_SQL = `
  DROP INDEX html_view_drafts_source_worktree;
  ALTER TABLE html_view_drafts DROP COLUMN source_worktree_id;
`;

export function withoutV26Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return rows.map((row) => {
    const rest = { ...row };
    if (table === "html_view_drafts" && "source_worktree_id" in rest) {
      assert.equal(rest.source_worktree_id, null);
      delete rest.source_worktree_id;
    }
    return rest;
  });
}
