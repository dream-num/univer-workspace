import type { DatabaseSync } from "node:sqlite";

/**
 * Add a verified Email address to Users and short-lived Email login codes for
 * passwordless sign-in. Existing Users keep a NULL Email; no existing row is
 * rewritten and every credential, Space, Session, and recovery state is preserved.
 */
export function migrateV13ToV14(database: DatabaseSync): void {
  const previousUsers = count(database, "users");
  const previousSessions = count(database, "login_sessions");

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
      CREATE UNIQUE INDEX users_email
        ON users(email)
        WHERE email IS NOT NULL;
      CREATE TABLE email_login_codes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX email_login_codes_email
        ON email_login_codes(email, created_at DESC);
      CREATE INDEX email_login_codes_expiry
        ON email_login_codes(expires_at);
      PRAGMA user_version = 14;
    `);
    if (count(database, "users") !== previousUsers) {
      throw new Error("V14 migration changed the User count.");
    }
    if (count(database, "login_sessions") !== previousSessions) {
      throw new Error("V14 migration changed the login Session count.");
    }
    const emails = database
      .prepare("SELECT COUNT(*) AS count FROM users WHERE email IS NOT NULL")
      .get() as { readonly count: number };
    if (emails.count !== 0) {
      throw new Error("V14 migration introduced Email identities.");
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("V14 migration failed foreign_key_check.");
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      readonly integrity_check?: unknown;
    };
    if (integrity.integrity_check !== "ok") {
      throw new Error("V14 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    readonly count: number;
  };
  return row.count;
}
