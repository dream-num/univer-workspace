import type { DatabaseSync } from "node:sqlite";

/** V35 -> V36: add the empty sign-in code table and its indexes; no row is rewritten. */
export function migrateV35ToV36(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
CREATE TABLE sign_in_codes (
  kind TEXT NOT NULL CHECK (kind IN ('oauth_code', 'consent', 'claim', 'cli')),
  code_hash TEXT NOT NULL,
  user_code_hash TEXT UNIQUE,
  subject_user_id TEXT,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'consumed', 'replayed')),
  grant_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, code_hash)
);
CREATE INDEX sign_in_codes_expiry
  ON sign_in_codes(kind, expires_at, state);
CREATE INDEX sign_in_codes_subject
  ON sign_in_codes(kind, subject_user_id, expires_at);

PRAGMA user_version = 36;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V36 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V36 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
