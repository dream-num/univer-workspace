import type { DatabaseSync } from "node:sqlite";

/** V34 -> V35: add the empty source rate event table and its indexes; no row is rewritten. */
export function migrateV34ToV35(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
CREATE TABLE source_rate_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX source_rate_events_source
  ON source_rate_events(action, source, created_at);
CREATE INDEX source_rate_events_expiry
  ON source_rate_events(created_at);

PRAGMA user_version = 35;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V35 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V35 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
