import { DROP_V17_SQL } from "./v17-downgrade.js";

/** Removes the V17 PDF Unit type and the V16 source columns so a schema.sql-built fixture reads as V15. */
export const DROP_V16_SQL = `
  ${DROP_V17_SQL}
  ALTER TABLE issues DROP COLUMN created_via;
  ALTER TABLE worktrees DROP COLUMN created_via;
  ALTER TABLE login_sessions DROP COLUMN write_source;
`;

export const DOWNGRADE_TO_V15_SQL = `
  ${DROP_V16_SQL}
  PRAGMA user_version = 15;
`;
