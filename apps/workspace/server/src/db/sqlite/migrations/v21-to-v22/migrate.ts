import type { DatabaseSync } from "node:sqlite";
import {
  planDisplayNameRepair,
  type StoredDisplayName,
  type StoredPersonalSpaceName,
} from "../../../display-name-repair.js";

export function migrateV21ToV22(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    repairDisplayNames(database);
    database.exec("PRAGMA user_version = 22");
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V22 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V22 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

// Scope, failure semantics and exit condition: see planDisplayNameRepair in db/display-name-repair.ts.
export function repairDisplayNames(database: DatabaseSync): void {
  const repair = planDisplayNameRepair(
    database.prepare("SELECT id, username, display_name FROM users").all() as unknown as StoredDisplayName[],
    database.prepare("SELECT id, owner_user_id, name FROM spaces WHERE type = 'personal'").all() as unknown as StoredPersonalSpaceName[],
  );
  const user = database.prepare("UPDATE users SET display_name = ? WHERE id = ?");
  for (const { id, displayName } of repair.users) user.run(displayName, id);
  const space = database.prepare("UPDATE spaces SET name = ? WHERE id = ?");
  for (const { id, name } of repair.spaces) space.run(name, id);
}
