import type { DatabaseSync } from "node:sqlite";

/**
 * Allow the PDF Unit type on Trunk Univer Resources and Worktree Node intents.
 * Every other column, constraint, trigger, and row is preserved; both tables are
 * rebuilt because SQLite cannot alter a CHECK. The rebuilt table is created under
 * a temporary name, filled, and renamed into place after the old table is dropped,
 * so the inbound `content_permission_objects` foreign key keeps naming
 * `univer_resources`. The rename runs under `legacy_alter_table` because the
 * Asset triggers on other tables look up `univer_resources` by name: the default
 * rename validation refuses while that table is momentarily absent, while the
 * legacy mode leaves those trigger bodies untouched so they resolve to the
 * rebuilt table.
 */
export function migrateV16ToV17(database: DatabaseSync): void {
  const previousResources = database.prepare(
    `SELECT resource_id, unit_id, unit_type FROM univer_resources
     ORDER BY resource_id`
  ).all();
  const previousIntents = database.prepare(
    `SELECT worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
            name, unit_type, created_by, activated_at, discarded_at, created_at,
            updated_at
     FROM worktree_node_intents
     ORDER BY worktree_id, unit_id`
  ).all();

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE univer_resources_v17 (
        resource_id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL UNIQUE,
        unit_type TEXT NOT NULL CHECK (
          unit_type IN ('sheet', 'doc', 'slide', 'board', 'base', 'pdf')
        ),
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
      );
      INSERT INTO univer_resources_v17 (resource_id, unit_id, unit_type)
      SELECT resource_id, unit_id, unit_type FROM univer_resources;
      DROP TABLE univer_resources;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE univer_resources_v17 RENAME TO univer_resources;
      PRAGMA legacy_alter_table = OFF;
      CREATE TRIGGER univer_resources_kind_guard
      BEFORE INSERT ON univer_resources
      FOR EACH ROW
      WHEN COALESCE(
        (SELECT kind FROM resources WHERE id = NEW.resource_id),
        ''
      ) <> 'univer'
      BEGIN
        SELECT RAISE(ABORT, 'univer extension requires kind=univer');
      END;

      CREATE TABLE worktree_node_intents_v17 (
        worktree_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        node_id TEXT NOT NULL UNIQUE,
        target_space_id TEXT NOT NULL,
        target_parent_node_id TEXT,
        name TEXT NOT NULL,
        unit_type TEXT NOT NULL CHECK (
          unit_type IN ('sheet', 'doc', 'slide', 'board', 'base', 'pdf')
        ),
        created_by TEXT NOT NULL,
        activated_at INTEGER,
        discarded_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (worktree_id, unit_id),
        CHECK (activated_at IS NULL OR discarded_at IS NULL),
        FOREIGN KEY (worktree_id, unit_id)
          REFERENCES worktree_units(worktree_id, unit_id)
          ON DELETE CASCADE,
        FOREIGN KEY (target_space_id) REFERENCES spaces(id) ON DELETE RESTRICT,
        FOREIGN KEY (target_parent_node_id) REFERENCES nodes(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      );
      INSERT INTO worktree_node_intents_v17
        (worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
         name, unit_type, created_by, activated_at, discarded_at, created_at,
         updated_at)
      SELECT
        worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
        name, unit_type, created_by, activated_at, discarded_at, created_at,
        updated_at
      FROM worktree_node_intents;
      DROP TABLE worktree_node_intents;
      ALTER TABLE worktree_node_intents_v17 RENAME TO worktree_node_intents;
      PRAGMA user_version = 17;
    `);
    const migratedResources = database.prepare(
      `SELECT resource_id, unit_id, unit_type FROM univer_resources
       ORDER BY resource_id`
    ).all();
    if (JSON.stringify(migratedResources) !== JSON.stringify(previousResources)) {
      throw new Error("V17 migration did not preserve every Univer Resource.");
    }
    const migratedIntents = database.prepare(
      `SELECT worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
              name, unit_type, created_by, activated_at, discarded_at, created_at,
              updated_at
       FROM worktree_node_intents
       ORDER BY worktree_id, unit_id`
    ).all();
    if (JSON.stringify(migratedIntents) !== JSON.stringify(previousIntents)) {
      throw new Error("V17 migration did not preserve every Worktree Node intent.");
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("V17 migration failed foreign_key_check.");
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      readonly integrity_check?: unknown;
    };
    if (integrity.integrity_check !== "ok") {
      throw new Error("V17 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}
