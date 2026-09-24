-- Schema captured from published SDK 1.0.0-rc.0 SQLite Adapters.
-- Test fixture only; production migration is owned by SDK public exports.
CREATE TABLE collaboration_changesets (
          unit_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 2),
          base_revision INTEGER NOT NULL CHECK (base_revision >= 1),
          sid TEXT NOT NULL,
          req_id INTEGER NOT NULL CHECK (req_id >= 1),
          payload_json TEXT NOT NULL,
          PRIMARY KEY (unit_id, revision),
          UNIQUE (unit_id, sid, req_id),
          FOREIGN KEY (unit_id)
            REFERENCES collaboration_units(unit_id) ON DELETE CASCADE
        );

CREATE TABLE collaboration_history_revisions (
          unit_id TEXT NOT NULL,
          type INTEGER NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          user_id TEXT NOT NULL,
          commands_json TEXT NOT NULL,
          committed_at INTEGER NOT NULL CHECK (committed_at >= 0),
          additional_fields TEXT,
          origin INTEGER NOT NULL,
          history_revision INTEGER NOT NULL CHECK (history_revision >= 1),
          force_next_history INTEGER NOT NULL,
          restored_revision INTEGER,
          PRIMARY KEY (unit_id, revision)
        );

CREATE TABLE collaboration_resources (
          unit_id TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (unit_id, resource_id),
          FOREIGN KEY (unit_id)
            REFERENCES collaboration_units(unit_id) ON DELETE CASCADE
        );

CREATE TABLE collaboration_schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL CHECK (version >= 1)
          );

CREATE TABLE collaboration_sheet_blocks (
          unit_id TEXT NOT NULL,
          block_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (unit_id, block_id),
          FOREIGN KEY (unit_id)
            REFERENCES collaboration_units(unit_id) ON DELETE CASCADE
        );

CREATE TABLE collaboration_snapshots (
          unit_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          type INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (unit_id, revision),
          FOREIGN KEY (unit_id)
            REFERENCES collaboration_units(unit_id) ON DELETE CASCADE
        );

CREATE TABLE collaboration_unit_tombstones (
          unit_id TEXT PRIMARY KEY,
          purged_at INTEGER NOT NULL
        );

CREATE TABLE collaboration_units (
          unit_id TEXT PRIMARY KEY,
          type INTEGER NOT NULL,
          head_revision INTEGER NOT NULL CHECK (head_revision >= 1),
          soft_deleted_at_ms INTEGER
        );

CREATE TABLE collaboration_worktree_changesets (
          worktree_id TEXT NOT NULL,
          unit_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 2),
          base_revision INTEGER NOT NULL CHECK (base_revision >= 1),
          sid TEXT NOT NULL,
          req_id INTEGER NOT NULL CHECK (req_id >= 1),
          payload_json TEXT NOT NULL,
          PRIMARY KEY (worktree_id, unit_id, revision),
          UNIQUE (worktree_id, unit_id, sid, req_id),
          FOREIGN KEY (worktree_id, unit_id)
            REFERENCES collaboration_worktree_units(worktree_id, unit_id)
            ON DELETE CASCADE
        );

CREATE TABLE collaboration_worktree_unit_merge_artifacts (
          worktree_id TEXT NOT NULL,
          unit_id TEXT NOT NULL,
          ready_draft_head_revision INTEGER NOT NULL
            CHECK (ready_draft_head_revision >= 1),
          snapshot_json TEXT NOT NULL,
          sheet_blocks_json TEXT,
          resources_json TEXT,
          PRIMARY KEY (worktree_id, unit_id),
          FOREIGN KEY (worktree_id, unit_id)
            REFERENCES collaboration_worktree_units(worktree_id, unit_id)
            ON DELETE CASCADE
        );

CREATE TABLE collaboration_worktree_unit_seeds (
          worktree_id TEXT NOT NULL,
          unit_id TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          sheet_blocks_json TEXT,
          resources_json TEXT,
          PRIMARY KEY (worktree_id, unit_id),
          FOREIGN KEY (worktree_id, unit_id)
            REFERENCES collaboration_worktree_units(worktree_id, unit_id)
            ON DELETE CASCADE
        );

CREATE TABLE collaboration_worktree_units (
          removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
          worktree_id TEXT NOT NULL,
          unit_id TEXT NOT NULL,
          unit_order INTEGER NOT NULL CHECK (unit_order >= 0),
          type INTEGER NOT NULL,
          source TEXT NOT NULL
            CHECK (source IN ('trunk', 'worktree')),
          baseline_trunk_revision INTEGER NOT NULL
            CHECK (baseline_trunk_revision >= 1),
          draft_head_revision INTEGER NOT NULL
            CHECK (draft_head_revision >= baseline_trunk_revision),
          ready_draft_head_revision INTEGER,
          merge_result_json TEXT,
          PRIMARY KEY (worktree_id, unit_id),
          UNIQUE (worktree_id, unit_order),
          FOREIGN KEY (worktree_id)
            REFERENCES collaboration_worktrees(worktree_id) ON DELETE CASCADE
        );

CREATE TABLE collaboration_worktrees (
          worktree_id TEXT PRIMARY KEY,
          sid TEXT NOT NULL,
          status TEXT NOT NULL
            CHECK (status IN ('draft', 'ready', 'merging', 'merged', 'discarded'))
        );

CREATE INDEX collaboration_changesets_revision_range
          ON collaboration_changesets(unit_id, revision ASC);

CREATE INDEX collaboration_history_creator_lookup
          ON collaboration_history_revisions(unit_id, user_id);

CREATE INDEX collaboration_history_record_lookup
          ON collaboration_history_revisions(unit_id, history_revision DESC);

CREATE INDEX collaboration_snapshots_nearest_revision
          ON collaboration_snapshots(unit_id, revision DESC);

CREATE INDEX collaboration_worktree_changesets_revision
          ON collaboration_worktree_changesets(
            worktree_id, unit_id, revision ASC
          );
INSERT INTO collaboration_schema_versions VALUES ('core', 1);
INSERT INTO collaboration_schema_versions VALUES ('worktree', 2);
INSERT INTO collaboration_schema_versions VALUES ('history', 1);
