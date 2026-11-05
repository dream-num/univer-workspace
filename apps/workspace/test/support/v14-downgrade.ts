/** Strips the V14 Email identity tables from a schema.sql-built fixture. */
export const DROP_V14_SQL = `
  DROP TABLE IF EXISTS email_login_codes;
  DROP TABLE IF EXISTS user_emails;
`;
