import type { DatabaseSync } from "node:sqlite";

/** Add an opt-in, authenticated public-read policy to every Space. */
export function migrateV5ToV6(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const columns = database.prepare("PRAGMA table_info(spaces)").all() as unknown as Array<{
      readonly name: string;
    }>;
    if (!columns.some((column) => column.name === "public_read")) {
      database.exec(`
        ALTER TABLE spaces ADD COLUMN public_read INTEGER NOT NULL DEFAULT 0
          CHECK (public_read IN (0, 1));
      `);
    }
    database.exec("PRAGMA user_version = 6");
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("V6 migration failed foreign_key_check.");
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      readonly integrity_check?: unknown;
    };
    if (integrity.integrity_check !== "ok") {
      throw new Error("V6 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
