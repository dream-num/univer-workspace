import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_IDENTITY = "univer-observer";
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE observer_schema (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  identity TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE observer_members (
  github_user_id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  added_by_github_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (added_by_github_user_id)
    REFERENCES observer_members(github_user_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX observer_members_login
  ON observer_members(github_login COLLATE NOCASE);

CREATE TABLE observer_sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  github_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (github_user_id)
    REFERENCES observer_members(github_user_id) ON DELETE CASCADE
);
CREATE INDEX observer_sessions_member
  ON observer_sessions(github_user_id, created_at DESC);
CREATE INDEX observer_sessions_expiry
  ON observer_sessions(expires_at);

CREATE TABLE observer_access_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  actor_github_user_id TEXT,
  actor_github_login TEXT,
  target_github_user_id TEXT,
  target_github_login TEXT,
  action TEXT NOT NULL CHECK (action IN ('setup', 'add', 'remove')),
  result TEXT NOT NULL CHECK (result IN ('succeeded', 'rejected')),
  created_at INTEGER NOT NULL
);
CREATE INDEX observer_access_events_created
  ON observer_access_events(created_at DESC, sequence DESC);

CREATE TRIGGER observer_access_events_no_update
BEFORE UPDATE ON observer_access_events
BEGIN SELECT RAISE(ABORT, 'observer access events are immutable'); END;

CREATE TRIGGER observer_access_events_no_delete
BEFORE DELETE ON observer_access_events
BEGIN SELECT RAISE(ABORT, 'observer access events are immutable'); END;

INSERT INTO observer_schema (id, identity, version)
VALUES (1, '${SCHEMA_IDENTITY}', ${SCHEMA_VERSION});
PRAGMA user_version = ${SCHEMA_VERSION};
`;

export class ObservationDatabase {
  readonly connection: DatabaseSync;
  private _closed = false;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.connection = new DatabaseSync(filename);
    try {
      this.connection.exec("PRAGMA foreign_keys = ON");
      this.connection.exec("PRAGMA busy_timeout = 5000");
      if (filename !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL");
      const version = this.connection.prepare("PRAGMA user_version").get() as {
        readonly user_version: number;
      };
      if (version.user_version === 0 && !hasApplicationTables(this.connection)) {
        this.connection.exec(`BEGIN IMMEDIATE;${SCHEMA}COMMIT;`);
      } else if (version.user_version !== SCHEMA_VERSION) {
        throw new Error(
          `Unsupported Observer database version ${version.user_version}; expected ${SCHEMA_VERSION}.`
        );
      }
      verifySchema(this.connection);
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  transaction<T>(operation: (database: DatabaseSync) => T): T {
    if (this._closed) throw new Error("Observer database is closed");
    if (this.connection.isTransaction) {
      throw new Error("Nested Observer database transactions are not supported");
    }
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(this.connection);
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.connection.isTransaction) this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.connection.close();
  }
}

function hasApplicationTables(database: DatabaseSync): boolean {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    .get() as { readonly count: number };
  return row.count > 0;
}

function verifySchema(database: DatabaseSync): void {
  const identity = database
    .prepare("SELECT identity, version FROM observer_schema WHERE id = 1")
    .get() as { readonly identity: string; readonly version: number } | undefined;
  if (
    identity?.identity !== SCHEMA_IDENTITY ||
    identity.version !== SCHEMA_VERSION
  ) {
    throw new Error("Observer database identity or schema version is invalid.");
  }
  const expectedColumns: Readonly<Record<string, readonly string[]>> = {
    observer_schema: ["id", "identity", "version"],
    observer_members: [
      "github_user_id", "github_login", "display_name", "avatar_url",
      "added_by_github_user_id", "created_at", "updated_at",
    ],
    observer_sessions: [
      "id", "secret_hash", "github_user_id", "created_at", "expires_at",
    ],
    observer_access_events: [
      "sequence", "id", "actor_github_user_id", "actor_github_login",
      "target_github_user_id", "target_github_login", "action", "result",
      "created_at",
    ],
  };
  for (const [table, columns] of Object.entries(expectedColumns)) {
    const found = database
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!found) throw new Error(`Observer database table ${table} is missing.`);
    const actual = database.prepare(`PRAGMA table_info(${table})`).all().map((row) =>
      (row as { readonly name: string }).name
    );
    if (actual.length !== columns.length || actual.some((name, index) => name !== columns[index])) {
      throw new Error(`Observer database table ${table} does not match Schema V1.`);
    }
  }
  for (const trigger of [
    "observer_access_events_no_update",
    "observer_access_events_no_delete",
  ]) {
    const found = database
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get(trigger);
    if (!found) throw new Error(`Observer database trigger ${trigger} is missing.`);
  }
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) {
    throw new Error("Observer database foreign key check failed.");
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as {
    readonly integrity_check: string;
  };
  if (integrity.integrity_check !== "ok") {
    throw new Error(`Observer database integrity check failed: ${integrity.integrity_check}`);
  }
}
