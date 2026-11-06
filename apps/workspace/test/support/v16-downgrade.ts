export const DROP_V16_SQL = `
  ALTER TABLE issues DROP COLUMN created_via;
  ALTER TABLE worktrees DROP COLUMN created_via;
  ALTER TABLE login_sessions DROP COLUMN write_source;
`;

export const DOWNGRADE_TO_V15_SQL = `
  ${DROP_V16_SQL}
  PRAGMA user_version = 15;
`;
