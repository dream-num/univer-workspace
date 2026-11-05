import type { DatabaseSync } from "node:sqlite";

export function migrateV14ToV15(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE INDEX space_stars_user ON space_stars(user_id, created_at);
      CREATE TABLE space_pins (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, space_id),
        UNIQUE (user_id, position)
      );
      PRAGMA user_version = 15;
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("V15 migration failed foreign_key_check.");
    }
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
      throw new Error("V15 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
