import { DROP_V15_SQL } from "./v15-downgrade.js";

/** Removes V15 pins and V14 Email structures for older-schema fixtures. */
export const DROP_V14_SQL = `
  ${DROP_V15_SQL}
  DROP INDEX IF EXISTS users_email;
  DROP TABLE IF EXISTS email_login_codes;
  ALTER TABLE users DROP COLUMN email;
`;
