/**
 * Removes the V18 MCP token tables and the two login_sessions token columns so a
 * schema.sql-built fixture reads as V17. The columns go first because a table
 * cannot be dropped while a column still references it; every other structure and
 * row is untouched.
 */
export const DROP_V18_SQL = `
  DROP TABLE IF EXISTS skill_drafts;
  DROP TABLE IF EXISTS html_view_drafts;
  DROP INDEX IF EXISTS login_sessions_pat;
  DROP INDEX IF EXISTS login_sessions_grant;
  ALTER TABLE login_sessions DROP COLUMN issued_for_grant_id;
  ALTER TABLE login_sessions DROP COLUMN issued_for_pat_id;
  DROP TABLE personal_access_tokens;
  DROP TABLE oauth_refresh_history;
  DROP TABLE oauth_grants;
  DROP TABLE oauth_clients;
`;

export const DOWNGRADE_TO_V17_SQL = `
  ${DROP_V18_SQL}
  PRAGMA user_version = 17;
`;
