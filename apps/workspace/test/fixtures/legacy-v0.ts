import type { DatabaseSync } from "node:sqlite";

export function createLegacyV0Schema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      avatar_url TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE spaces (
      id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('personal', 'team')),
      name TEXT NOT NULL, owner_user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );
    CREATE TABLE trash_batches (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, root_entry_id TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, restored_at INTEGER,
      FOREIGN KEY (space_id) REFERENCES spaces(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE TABLE catalog_entries (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, parent_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('folder', 'file')), name TEXT NOT NULL,
      created_by TEXT NOT NULL, trash_batch_id TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (space_id) REFERENCES spaces(id),
      FOREIGN KEY (parent_id) REFERENCES catalog_entries(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (trash_batch_id) REFERENCES trash_batches(id)
    );
    CREATE INDEX catalog_entries_parent
      ON catalog_entries(space_id, parent_id, trash_batch_id, name, id);
    CREATE INDEX catalog_entries_trash
      ON catalog_entries(space_id, trash_batch_id, id);
    CREATE TABLE files (
      entry_id TEXT PRIMARY KEY, unit_id TEXT NOT NULL UNIQUE,
      unit_type TEXT NOT NULL CHECK (unit_type IN ('sheet','doc','slide','board','base')),
      FOREIGN KEY (entry_id) REFERENCES catalog_entries(id)
    );
    CREATE TABLE catalog_entry_link_sharing (
      entry_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, role TEXT NOT NULL,
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES catalog_entries(id)
    );
    CREATE TABLE catalog_entry_grants (
      entry_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
      granted_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (entry_id, user_id),
      FOREIGN KEY (entry_id) REFERENCES catalog_entries(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX catalog_entry_grants_user
      ON catalog_entry_grants(user_id, updated_at DESC);
    CREATE TABLE recent_files (
      user_id TEXT NOT NULL, file_entry_id TEXT NOT NULL, last_opened_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, file_entry_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (file_entry_id) REFERENCES files(entry_id)
    );
    CREATE INDEX recent_files_user_opened
      ON recent_files(user_id, last_opened_at DESC, file_entry_id);
    CREATE TABLE worktrees (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT, creator_user_id TEXT NOT NULL,
      kind TEXT NOT NULL, team_space_id TEXT, visibility TEXT NOT NULL, processed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY (creator_user_id) REFERENCES users(id)
    );
    CREATE TABLE worktree_units (
      worktree_id TEXT NOT NULL, unit_id TEXT NOT NULL, file_entry_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('trunk', 'worktree')),
      ordinal INTEGER NOT NULL, added_at INTEGER NOT NULL,
      PRIMARY KEY (worktree_id, unit_id), UNIQUE (worktree_id, file_entry_id),
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id)
    );
    CREATE TABLE worktree_new_files (
      worktree_id TEXT NOT NULL, unit_id TEXT NOT NULL, target_space_id TEXT NOT NULL,
      target_parent_id TEXT, name TEXT NOT NULL, unit_type TEXT NOT NULL,
      created_by TEXT NOT NULL, activated_at INTEGER, discarded_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (worktree_id, unit_id),
      FOREIGN KEY (worktree_id, unit_id) REFERENCES worktree_units(worktree_id, unit_id),
      FOREIGN KEY (target_space_id) REFERENCES spaces(id),
      FOREIGN KEY (target_parent_id) REFERENCES catalog_entries(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE TABLE operations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN (
        'create_file','create_worktree','add_worktree_unit','create_worktree_unit',
        'merge_worktree','discard_worktree','activate_worktree_file'
      )),
      actor_user_id TEXT NOT NULL, step TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','completed','failed')),
      payload_json TEXT NOT NULL, result_json TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL, last_error_code TEXT, last_error_message TEXT,
      lease_owner TEXT, lease_expires_at INTEGER, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, completed_at INTEGER,
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );
    CREATE INDEX operations_due ON operations(state, next_attempt_at, lease_expires_at);
    CREATE INDEX operations_actor ON operations(actor_user_id, created_at DESC);
    PRAGMA user_version = 0;
  `);
}

export function seedRichLegacyV0(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO users VALUES
      ('alice','alice','Alice',NULL,100,100),
      ('bob','bob','Bob',NULL,101,101);
    INSERT INTO spaces VALUES
      ('space','personal','Alice Space','alice',110,110);
    INSERT INTO trash_batches VALUES
      ('trash','space','trashed-file','alice',120,NULL);
    INSERT INTO catalog_entries VALUES
      ('root','space',NULL,'folder','Root','alice',NULL,200,201),
      ('doc-node','space','root','file','Plan','alice',NULL,210,211),
      ('activated-node','space','root','file','Activated','alice',NULL,220,221),
      ('trashed-file','space',NULL,'file','Old','alice','trash',230,231);
    INSERT INTO files VALUES
      ('doc-node','unit-doc','doc'),
      ('activated-node','unit-activated','sheet'),
      ('trashed-file','unit-trash','slide');
    INSERT INTO catalog_entry_grants VALUES
      ('root','bob','editor','alice',300,301);
    INSERT INTO catalog_entry_link_sharing VALUES
      ('doc-node',1,'viewer','alice','alice',310,311);
    INSERT INTO recent_files VALUES
      ('alice','doc-node',400);
    INSERT INTO worktrees VALUES
      ('worktree','Draft',NULL,'alice','user',NULL,'private',NULL,500,501);
    INSERT INTO worktree_units VALUES
      ('worktree','unit-doc','doc-node','trunk',0,510),
      ('worktree','unit-local','future-node','worktree',1,511),
      ('worktree','unit-activated','activated-node','worktree',2,512);
    INSERT INTO worktree_new_files VALUES
      ('worktree','unit-local','space','root','Local','doc','alice',NULL,NULL,520,521),
      ('worktree','unit-activated','space','root','Activated','sheet','alice',530,NULL,522,530);
  `);
  const operations = [
    [
      "op-create-file",
      "create_file",
      {
        spaceId: "space",
        parentId: "root",
        name: "Plan",
        unitType: "doc",
        entryId: "doc-node",
        unitId: "unit-doc",
      },
      { fileEntryId: "doc-node" },
    ],
    [
      "op-create-worktree",
      "create_worktree",
      { kind: "user", name: "Draft", worktreeId: "worktree" },
      { worktreeId: "worktree" },
    ],
    [
      "op-add-unit",
      "add_worktree_unit",
      {
        source: "trunk",
        fileId: "doc-node",
        unitId: "unit-doc",
        worktreeId: "worktree",
      },
      { worktreeId: "worktree", unitId: "unit-doc" },
    ],
    [
      "op-create-unit",
      "create_worktree_unit",
      {
        source: "worktree",
        name: "Local",
        unitType: "doc",
        targetSpaceId: "space",
        targetParentId: "root",
        worktreeId: "worktree",
        unitId: "unit-local",
        fileEntryId: "future-node",
        requestedUnitId: null,
        requestedFileId: null,
      },
      { worktreeId: "worktree", unitId: "unit-local" },
    ],
    [
      "op-merge",
      "merge_worktree",
      { worktreeId: "worktree" },
      { worktreeId: "worktree", state: "merged" },
    ],
    [
      "op-discard",
      "discard_worktree",
      { worktreeId: "worktree" },
      { worktreeId: "worktree", state: "discarded" },
    ],
    [
      "op-activate",
      "activate_worktree_file",
      {
        worktreeId: "worktree",
        unitId: "unit-activated",
        fileEntryId: "activated-node",
      },
      {
        worktreeId: "worktree",
        unitId: "unit-activated",
        fileEntryId: "activated-node",
      },
    ],
  ] as const;
  const insert = database.prepare(
    `INSERT INTO operations
      (id,kind,actor_user_id,step,state,payload_json,result_json,attempt_count,
       next_attempt_at,created_at,updated_at,completed_at)
     VALUES (?,?,'alice','completed','completed',?,?,1,0,600,601,601)`
  );
  for (const [id, kind, payload, result] of operations) {
    insert.run(id, kind, JSON.stringify(payload), JSON.stringify(result));
  }
}
