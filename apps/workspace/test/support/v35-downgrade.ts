import { DROP_V36_SQL } from "./v36-downgrade.js";

/** Drops the V35 source rate event table, with its indexes, so a schema.sql-built fixture reads as V34. */
export const DROP_V35_SQL = `${DROP_V36_SQL}
  DROP TABLE source_rate_events;
`;
