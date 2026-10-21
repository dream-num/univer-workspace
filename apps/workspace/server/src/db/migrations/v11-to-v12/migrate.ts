import type { DatabaseSync } from "node:sqlite";

/**
 * Adds the Repository slug and Worktree number columns. Structure only: existing
 * rows keep NULL and are not backfilled. Keep the DDL in step with schema.sql.
 */
export function migrateV11ToV12(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      ALTER TABLE spaces ADD COLUMN slug TEXT COLLATE NOCASE;
      CREATE UNIQUE INDEX spaces_owner_slug
        ON spaces(owner_user_id, slug)
        WHERE slug IS NOT NULL;
      CREATE TRIGGER spaces_slug_insert
      BEFORE INSERT ON spaces
      WHEN NEW.slug IS NOT NULL AND (NEW.type <> 'team' OR NEW.slug = 'personal')
      BEGIN
        SELECT RAISE(ABORT, 'only a team space can have a slug, and personal is reserved');
      END;
      CREATE TRIGGER spaces_slug_update
      BEFORE UPDATE OF slug, type ON spaces
      WHEN NEW.slug IS NOT NULL AND (NEW.type <> 'team' OR NEW.slug = 'personal')
      BEGIN
        SELECT RAISE(ABORT, 'only a team space can have a slug, and personal is reserved');
      END;
      ALTER TABLE worktrees ADD COLUMN number INTEGER;
      CREATE UNIQUE INDEX worktrees_team_number
        ON worktrees(team_space_id, number)
        WHERE kind = 'team' AND number IS NOT NULL;
      CREATE UNIQUE INDEX worktrees_user_number
        ON worktrees(creator_user_id, number)
        WHERE kind = 'user' AND number IS NOT NULL;
      PRAGMA user_version = 12;
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("V12 migration failed foreign_key_check.");
    }
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
      throw new Error("V12 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
