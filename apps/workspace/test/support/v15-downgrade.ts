import { DROP_V16_SQL } from "./v16-downgrade.js";

export const DROP_V15_SQL = `
  ${DROP_V16_SQL}
  DROP TABLE IF EXISTS space_pins;
  DROP INDEX IF EXISTS space_stars_user;
`;

export const DOWNGRADE_TO_V14_SQL = `
  ${DROP_V15_SQL}
  PRAGMA user_version = 14;
`;
