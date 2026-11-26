/** Drops the V36 sign-in code table, with its indexes, so a schema.sql-built fixture reads as V35. */
export const DROP_V36_SQL = `
  DROP TABLE sign_in_codes;
`;
