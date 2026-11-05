/**
 * Strips the V14 Email sign-in structures from a schema.sql-built fixture:
 * the `users.email` column, its partial unique index, and the code table.
 */
export const DROP_V14_SQL = `
  DROP INDEX IF EXISTS users_email;
  DROP TABLE IF EXISTS email_login_codes;
  ALTER TABLE users DROP COLUMN email;
`;
