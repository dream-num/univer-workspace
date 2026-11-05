import { DROP_V14_SQL } from "./v14-downgrade.js";

/**
 * Removes the V14 Email identity tables so a schema.sql-built fixture reads as V13.
 * Every other structure and row is untouched.
 */
export const DOWNGRADE_TO_V13_SQL = `
  ${DROP_V14_SQL}
  PRAGMA user_version = 13;
`;

/**
 * Rebuilds External Identities with the V12 Provider CHECK, then removes the V14
 * Email tables, so a schema.sql-built fixture reads as V12: the Google Provider is
 * absent and every other structure and row is untouched.
 */
export const DOWNGRADE_TO_V12_SQL = `
  ${DOWNGRADE_TO_V13_SQL}
  PRAGMA foreign_keys = OFF;
  ALTER TABLE external_identities RENAME TO external_identities_v13;
  CREATE TABLE external_identities (
    provider TEXT NOT NULL CHECK (provider IN ('github', 'discord')),
    provider_subject TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider_username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (provider, provider_subject),
    UNIQUE (user_id, provider),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  INSERT INTO external_identities
    (provider, provider_subject, user_id, provider_username, created_at, updated_at)
  SELECT
    provider, provider_subject, user_id, provider_username, created_at, updated_at
  FROM external_identities_v13;
  DROP TABLE external_identities_v13;
  PRAGMA user_version = 12;
  PRAGMA foreign_keys = ON;
`;
