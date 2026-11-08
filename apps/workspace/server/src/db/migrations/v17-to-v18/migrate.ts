import type { DatabaseSync } from "node:sqlite";

/**
 * Adds MCP OAuth clients, OAuth grants, their retired refresh-token history, personal access tokens and the two
 * nullable login_sessions columns that tie a downstream session to the token
 * it was issued for. Every column is appended with ADD COLUMN: SQLite accepts a
 * REFERENCES clause and a CHECK on an added column whose default is NULL, so no
 * table is rebuilt and every existing session row and expiry is untouched.
 */
export function migrateV17ToV18(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const sessions = database.prepare(
      "SELECT id, secret_hash, user_id, created_at, expires_at, write_source FROM login_sessions ORDER BY id"
    ).all();
    database.exec(`
      CREATE TABLE oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_name TEXT,
        redirect_uris TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE TABLE oauth_grants (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL,
        scopes TEXT NOT NULL,
        resource TEXT NOT NULL,
        access_token_hash TEXT NOT NULL UNIQUE,
        access_expires_at INTEGER NOT NULL,
        refresh_token_hash TEXT NOT NULL UNIQUE,
        refresh_expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX oauth_grants_user ON oauth_grants(user_id, created_at DESC);
      CREATE TABLE oauth_refresh_history (
        refresh_token_hash TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
        retired_at INTEGER NOT NULL
      );
      CREATE INDEX oauth_refresh_history_grant ON oauth_refresh_history(grant_id);
      CREATE TABLE personal_access_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX personal_access_tokens_user
        ON personal_access_tokens(user_id, created_at DESC);
      ALTER TABLE login_sessions ADD COLUMN issued_for_pat_id TEXT REFERENCES personal_access_tokens(id) ON DELETE CASCADE;
      ALTER TABLE login_sessions ADD COLUMN issued_for_grant_id TEXT REFERENCES oauth_grants(id) ON DELETE CASCADE
        CHECK (issued_for_pat_id IS NULL OR issued_for_grant_id IS NULL);
      CREATE INDEX login_sessions_pat
        ON login_sessions(issued_for_pat_id) WHERE issued_for_pat_id IS NOT NULL;
      CREATE INDEX login_sessions_grant
        ON login_sessions(issued_for_grant_id) WHERE issued_for_grant_id IS NOT NULL;
      PRAGMA user_version = 18;
    `);
    const migrated = database.prepare(
      "SELECT id, secret_hash, user_id, created_at, expires_at, write_source FROM login_sessions ORDER BY id"
    ).all();
    if (JSON.stringify(migrated) !== JSON.stringify(sessions)) {
      throw new Error("V18 migration did not preserve every login session.");
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("V18 migration failed foreign_key_check.");
    }
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
      throw new Error("V18 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
