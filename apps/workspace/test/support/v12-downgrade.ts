/** Strips the V12 slug and number structures from a schema.sql-built fixture so it reads as V11. */
export const DROP_V12_SQL = `
  DROP TRIGGER IF EXISTS spaces_slug_insert;
  DROP TRIGGER IF EXISTS spaces_slug_update;
  DROP INDEX IF EXISTS spaces_owner_slug;
  DROP INDEX IF EXISTS worktrees_team_number;
  DROP INDEX IF EXISTS worktrees_user_number;
  ALTER TABLE spaces DROP COLUMN slug;
  ALTER TABLE worktrees DROP COLUMN number;
`;
