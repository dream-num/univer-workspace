import type { DatabaseSync } from "node:sqlite";

/** Add product-owned content ACLs without rewriting existing tables or rows. */
export function migrateV7ToV8(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
CREATE TABLE content_permission_objects (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES univer_resources(unit_id) ON DELETE CASCADE,
  object_type INTEGER NOT NULL,
  creator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  strategies_json TEXT NOT NULL,
  edit_scope INTEGER NOT NULL CHECK (edit_scope IN (0, 1, 2)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX content_permission_objects_unit ON content_permission_objects(unit_id);
CREATE TABLE content_permission_collaborators (
  object_id TEXT NOT NULL REFERENCES content_permission_objects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role INTEGER NOT NULL CHECK (role IN (0, 1)),
  PRIMARY KEY (object_id, user_id)
);
PRAGMA user_version = 8;
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("V8 migration failed foreign_key_check.");
    }
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
      throw new Error("V8 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
