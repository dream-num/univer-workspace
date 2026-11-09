import { DROP_V18_SQL } from "./v18-downgrade.js";

/**
 * Removes the V18 token structures, then rebuilds Univer Resources and Worktree Node intents with the V16 Unit type
 * CHECK (no PDF) so a schema.sql-built fixture reads as V16. Both tables are
 * recreated under a temporary name and renamed into place, so the inbound
 * `content_permission_objects` foreign key keeps naming `univer_resources`; the
 * rename runs under `legacy_alter_table` so the Asset triggers that look it up
 * are left untouched. Every other structure and row is untouched.
 */
export const DROP_V17_SQL = `
  ${DROP_V18_SQL}
  PRAGMA foreign_keys = OFF;
  CREATE TABLE univer_resources_v16 (
    resource_id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL UNIQUE,
    unit_type TEXT NOT NULL CHECK (
      unit_type IN ('sheet', 'doc', 'slide', 'board', 'base')
    ),
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );
  INSERT INTO univer_resources_v16 (resource_id, unit_id, unit_type)
  SELECT resource_id, unit_id, unit_type FROM univer_resources;
  DROP TABLE univer_resources;
  PRAGMA legacy_alter_table = ON;
  ALTER TABLE univer_resources_v16 RENAME TO univer_resources;
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
  CREATE TABLE worktree_node_intents_v16 (
    worktree_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    node_id TEXT NOT NULL UNIQUE,
    target_space_id TEXT NOT NULL,
    target_parent_node_id TEXT,
    name TEXT NOT NULL,
    unit_type TEXT NOT NULL CHECK (
      unit_type IN ('sheet', 'doc', 'slide', 'board', 'base')
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
  INSERT INTO worktree_node_intents_v16
    (worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
     name, unit_type, created_by, activated_at, discarded_at, created_at, updated_at)
  SELECT
    worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
    name, unit_type, created_by, activated_at, discarded_at, created_at, updated_at
  FROM worktree_node_intents;
  DROP TABLE worktree_node_intents;
  ALTER TABLE worktree_node_intents_v16 RENAME TO worktree_node_intents;
  PRAGMA foreign_keys = ON;
`;

export const DOWNGRADE_TO_V16_SQL = `
  ${DROP_V17_SQL}
  PRAGMA user_version = 16;
`;
