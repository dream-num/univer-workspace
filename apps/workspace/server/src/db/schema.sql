PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_identities (
  provider TEXT NOT NULL CHECK (provider IN ('github', 'discord')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider_username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_subject),
  UNIQUE (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS login_sessions_user
  ON login_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS login_sessions_expiry
  ON login_sessions(expires_at);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('personal', 'team')),
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  public_read INTEGER NOT NULL DEFAULT 0 CHECK (public_read IN (0, 1)),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS spaces_personal_owner
  ON spaces(owner_user_id)
  WHERE type = 'personal';

CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS space_members_user
  ON space_members(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS trash_batches (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  root_node_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  restored_at INTEGER,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  trash_batch_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (trash_batch_id) REFERENCES trash_batches(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS nodes_parent
  ON nodes(space_id, parent_id, trash_batch_id, name, id);
CREATE INDEX IF NOT EXISTS nodes_trash
  ON nodes(space_id, trash_batch_id, id);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('univer', 'blob')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS univer_resources (
  resource_id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL UNIQUE,
  unit_type TEXT NOT NULL CHECK (
    unit_type IN ('sheet', 'doc', 'slide', 'board', 'base')
  ),
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blob_resources (
  resource_id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  etag TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (
    availability IN ('ready', 'quarantined')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS node_link_sharing (
  node_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS node_grants (
  node_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, user_id),
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS node_grants_user
  ON node_grants(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS recent_resources (
  user_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  last_opened_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, resource_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS recent_resources_user_opened
  ON recent_resources(user_id, last_opened_at DESC, resource_id ASC);

CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT,
  creator_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'team')),
  team_space_id TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'space')),
  processed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (kind = 'user' AND team_space_id IS NULL AND visibility = 'private')
    OR
    (kind = 'team' AND team_space_id IS NOT NULL)
  ),
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (team_space_id) REFERENCES spaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS worktrees_creator
  ON worktrees(creator_user_id, processed_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS worktrees_team_space
  ON worktrees(team_space_id, processed_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS worktree_units (
  worktree_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('trunk', 'worktree')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, unit_id),
  UNIQUE (worktree_id, resource_id),
  FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS worktree_node_intents (
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

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'create_resource',
      'create_blob_resource',
      'create_worktree',
      'add_worktree_unit',
      'create_worktree_unit',
      'merge_worktree',
      'discard_worktree',
      'activate_worktree_resource'
    )
  ),
  actor_user_id TEXT NOT NULL,
  step TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  payload_json TEXT NOT NULL,
  result_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_error_code TEXT,
  last_error_message TEXT,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS operations_due
  ON operations(state, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS operations_actor
  ON operations(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blob_upload_sessions (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  actor_user_id TEXT NOT NULL,
  target_space_id TEXT NOT NULL,
  target_parent_node_id TEXT,
  node_id TEXT NOT NULL UNIQUE,
  resource_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  node_name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  declared_media_type TEXT,
  detected_media_type TEXT,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  received_size INTEGER CHECK (received_size >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  etag TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'waiting_for_upload', 'uploaded', 'verifying',
      'completed', 'failed', 'expired', 'aborted'
    )
  ),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_space_id) REFERENCES spaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_parent_node_id) REFERENCES nodes(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS blob_upload_sessions_actor
  ON blob_upload_sessions(actor_user_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS blob_upload_sessions_recovery
  ON blob_upload_sessions(state, expires_at, updated_at, id);

CREATE TABLE IF NOT EXISTS univer_assets (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  worktree_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  etag TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (worktree_id, unit_id)
    REFERENCES worktree_units(worktree_id, unit_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS univer_assets_trunk_unit
  ON univer_assets(unit_id, created_at, id)
  WHERE worktree_id IS NULL;
CREATE INDEX IF NOT EXISTS univer_assets_worktree_unit
  ON univer_assets(worktree_id, unit_id, created_at, id)
  WHERE worktree_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS univer_asset_uploads (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL UNIQUE,
  unit_id TEXT NOT NULL,
  worktree_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  actor_user_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  declared_media_type TEXT,
  expected_size INTEGER NOT NULL CHECK (expected_size >= 0),
  received_size INTEGER CHECK (received_size >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  etag TEXT,
  state TEXT NOT NULL CHECK (state IN ('receiving', 'stored')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (
    state = 'receiving'
    OR (
      received_size = expected_size
      AND sha256 IS NOT NULL
      AND etag IS NOT NULL
    )
  ),
  FOREIGN KEY (worktree_id, unit_id)
    REFERENCES worktree_units(worktree_id, unit_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS univer_asset_uploads_recovery
  ON univer_asset_uploads(state, expires_at, updated_at, id);

CREATE TABLE IF NOT EXISTS object_deletion_jobs (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (
    reason IN (
      'blob_resource_deleted',
      'blob_upload_abandoned',
      'univer_unit_deleted',
      'univer_asset_upload_abandoned',
      'worktree_asset_expired'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS object_deletion_jobs_due
  ON object_deletion_jobs(next_attempt_at, lease_expires_at, id);

CREATE TRIGGER IF NOT EXISTS trash_batches_root_node_delete
AFTER DELETE ON nodes
FOR EACH ROW
BEGIN
  DELETE FROM trash_batches WHERE root_node_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS nodes_parent_insert
BEFORE INSERT ON nodes
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM nodes AS parent
      WHERE parent.id = NEW.parent_id
        AND parent.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'node parent must be in the same space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS nodes_parent_update
BEFORE UPDATE OF parent_id, space_id ON nodes
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.parent_id = NEW.id OR NOT EXISTS (
      SELECT 1
      FROM nodes AS parent
      WHERE parent.id = NEW.parent_id
        AND parent.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'node parent must be in the same space and not itself')
  END;
END;

CREATE TRIGGER IF NOT EXISTS space_members_team_only_insert
BEFORE INSERT ON space_members
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM spaces
      WHERE id = NEW.space_id
        AND type = 'team'
        AND owner_user_id <> NEW.user_id
    )
    THEN RAISE(ABORT, 'space member must belong to a team space and not be its owner')
  END;
END;

CREATE TRIGGER IF NOT EXISTS node_grants_personal_only_insert
BEFORE INSERT ON node_grants
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM nodes AS node
      JOIN spaces AS space ON space.id = node.space_id
      WHERE node.id = NEW.node_id
        AND space.type = 'personal'
        AND space.owner_user_id <> NEW.user_id
    )
    THEN RAISE(ABORT, 'node grant must target a personal-space node and not its owner')
  END;
END;

CREATE TRIGGER IF NOT EXISTS node_link_sharing_personal_only_insert
BEFORE INSERT ON node_link_sharing
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM nodes AS node
      JOIN spaces AS space ON space.id = node.space_id
      WHERE node.id = NEW.node_id
        AND space.type = 'personal'
    )
    THEN RAISE(ABORT, 'link sharing must target a personal-space node')
  END;
END;

CREATE TRIGGER IF NOT EXISTS resources_kind_immutable
BEFORE UPDATE OF kind ON resources
FOR EACH ROW
WHEN NEW.kind <> OLD.kind
BEGIN
  SELECT RAISE(ABORT, 'resource kind is immutable');
END;

CREATE TRIGGER IF NOT EXISTS univer_resources_kind_guard
BEFORE INSERT ON univer_resources
FOR EACH ROW
WHEN COALESCE(
  (SELECT kind FROM resources WHERE id = NEW.resource_id),
  ''
) <> 'univer'
BEGIN
  SELECT RAISE(ABORT, 'univer extension requires kind=univer');
END;

CREATE TRIGGER IF NOT EXISTS blob_resources_kind_guard
BEFORE INSERT ON blob_resources
FOR EACH ROW
WHEN COALESCE(
  (SELECT kind FROM resources WHERE id = NEW.resource_id),
  ''
) <> 'blob'
BEGIN
  SELECT RAISE(ABORT, 'blob extension requires kind=blob');
END;

CREATE TRIGGER IF NOT EXISTS univer_assets_trunk_unit_insert
BEFORE INSERT ON univer_assets
FOR EACH ROW
WHEN NEW.worktree_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
  )
BEGIN
  SELECT RAISE(ABORT, 'trunk asset requires an existing Univer unit');
END;

CREATE TRIGGER IF NOT EXISTS univer_assets_trunk_unit_update
BEFORE UPDATE OF unit_id, worktree_id ON univer_assets
FOR EACH ROW
WHEN NEW.worktree_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
  )
BEGIN
  SELECT RAISE(ABORT, 'trunk asset requires an existing Univer unit');
END;

CREATE TRIGGER IF NOT EXISTS univer_asset_uploads_trunk_unit_insert
BEFORE INSERT ON univer_asset_uploads
FOR EACH ROW
WHEN NEW.worktree_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
  )
BEGIN
  SELECT RAISE(ABORT, 'trunk asset upload requires an existing Univer unit');
END;

CREATE TRIGGER IF NOT EXISTS univer_asset_uploads_scope_update
BEFORE UPDATE OF unit_id, worktree_id ON univer_asset_uploads
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'asset upload scope is immutable');
END;

PRAGMA user_version = 6;
