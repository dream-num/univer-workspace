CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  email TEXT,
  kind TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'agent'))
);
CREATE UNIQUE INDEX users_username ON users(lower(username COLLATE "C"));
CREATE UNIQUE INDEX users_email
  ON users(lower(email COLLATE "C"))
  WHERE email IS NOT NULL;

CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE external_identities (
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google', 'discord')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider_username TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (provider, provider_subject),
  UNIQUE (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE email_login_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE INDEX email_login_codes_email
  ON email_login_codes(email, created_at DESC);
CREATE INDEX email_login_codes_expiry
  ON email_login_codes(expires_at);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('personal', 'team')),
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  public_read BOOLEAN NOT NULL DEFAULT false,
  description TEXT NOT NULL DEFAULT '',
  slug TEXT,
  proposals TEXT NOT NULL DEFAULT 'members' CHECK (proposals IN ('members', 'accountable', 'anyone')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX spaces_personal_owner
  ON spaces(owner_user_id)
  WHERE type = 'personal';
CREATE UNIQUE INDEX spaces_owner_slug
  ON spaces(owner_user_id, lower(slug COLLATE "C"))
  WHERE slug IS NOT NULL;

CREATE TABLE space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  granted_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (space_id, user_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX space_members_user
  ON space_members(user_id, updated_at DESC);

CREATE TABLE trash_batches (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  root_node_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  restored_at BIGINT,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  trash_batch_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  copied_from_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (trash_batch_id) REFERENCES trash_batches(id) ON DELETE SET NULL
);
CREATE INDEX nodes_parent
  ON nodes(space_id, parent_id, trash_batch_id, name, id);
CREATE INDEX nodes_trash
  ON nodes(space_id, trash_batch_id, id);
CREATE INDEX nodes_copied_from
  ON nodes(copied_from_node_id)
  WHERE copied_from_node_id IS NOT NULL;

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('univer', 'blob')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE univer_resources (
  resource_id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL UNIQUE,
  unit_type TEXT NOT NULL CHECK (
    unit_type IN ('sheet', 'doc', 'slide', 'board', 'base', 'pdf')
  ),
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE TABLE blob_resources (
  resource_id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  etag TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (
    availability IN ('ready', 'quarantined')
  ),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE TABLE node_link_sharing (
  node_id TEXT PRIMARY KEY,
  enabled BIGINT NOT NULL CHECK (enabled IN (0, 1)),
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  unverified_role TEXT NOT NULL DEFAULT 'viewer' CHECK (unverified_role IN ('editor', 'viewer')),
  making_of_note TEXT,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE node_grants (
  node_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  granted_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (node_id, user_id),
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX node_grants_user
  ON node_grants(user_id, updated_at DESC);

CREATE TABLE recent_resources (
  user_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  last_opened_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, resource_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);
CREATE INDEX recent_resources_user_opened
  ON recent_resources(user_id, last_opened_at DESC, resource_id ASC);

CREATE TABLE forks (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  upstream_space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (upstream_space_id) REFERENCES spaces(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX forks_owner_name
  ON forks(owner_user_id, lower(name COLLATE "C"));

CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT,
  creator_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'team')),
  team_space_id TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'space')),
  processed_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  number BIGINT,
  created_via TEXT CHECK (created_via IN ('browser', 'agent')),
  fork_id TEXT REFERENCES forks(id) ON DELETE SET NULL,
  issue_id TEXT,
  CONSTRAINT worktrees_fork_team CHECK (fork_id IS NULL OR kind = 'team'),
  CONSTRAINT worktrees_issue_team CHECK (issue_id IS NULL OR kind = 'team'),
  CHECK (
    (kind = 'user' AND team_space_id IS NULL AND visibility = 'private')
    OR
    (kind = 'team' AND team_space_id IS NOT NULL)
  ),
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (team_space_id) REFERENCES spaces(id) ON DELETE CASCADE
);
CREATE INDEX worktrees_creator
  ON worktrees(creator_user_id, processed_at, updated_at DESC);
CREATE INDEX worktrees_team_space
  ON worktrees(team_space_id, processed_at, updated_at DESC);
CREATE UNIQUE INDEX worktrees_team_number
  ON worktrees(team_space_id, number)
  WHERE kind = 'team' AND number IS NOT NULL;
CREATE UNIQUE INDEX worktrees_user_number
  ON worktrees(creator_user_id, number)
  WHERE kind = 'user' AND number IS NOT NULL;
CREATE UNIQUE INDEX worktrees_open_fork
  ON worktrees(fork_id)
  WHERE fork_id IS NOT NULL AND processed_at IS NULL;
CREATE INDEX worktrees_issue
  ON worktrees(issue_id)
  WHERE issue_id IS NOT NULL;

CREATE TABLE worktree_units (
  worktree_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('trunk', 'worktree')),
  ordinal BIGINT NOT NULL CHECK (ordinal >= 0),
  added_at BIGINT NOT NULL,
  PRIMARY KEY (worktree_id, unit_id),
  UNIQUE (worktree_id, resource_id),
  FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
);

CREATE TABLE worktree_node_intents (
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
  activated_at BIGINT,
  discarded_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  copied_from_node_id TEXT,
  PRIMARY KEY (worktree_id, unit_id),
  CHECK (activated_at IS NULL OR discarded_at IS NULL),
  FOREIGN KEY (worktree_id, unit_id)
    REFERENCES worktree_units(worktree_id, unit_id)
    ON DELETE CASCADE,
  FOREIGN KEY (target_space_id) REFERENCES spaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_parent_node_id) REFERENCES nodes(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'create_resource',
      'create_blob_resource',
      'replace_blob_content',
      'create_worktree',
      'add_worktree_unit',
      'create_worktree_unit',
      'merge_worktree',
      'discard_worktree',
      'activate_worktree_resource',
      'copy_node'
    )
  ),
  actor_user_id TEXT NOT NULL,
  step TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  payload_json TEXT NOT NULL,
  result_json TEXT,
  attempt_count BIGINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at BIGINT NOT NULL,
  last_error_code TEXT,
  last_error_message TEXT,
  lease_owner TEXT,
  lease_expires_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX operations_due
  ON operations(state, next_attempt_at, lease_expires_at);
CREATE INDEX operations_actor
  ON operations(actor_user_id, created_at DESC);

CREATE TABLE blob_upload_sessions (
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
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  received_size BIGINT CHECK (received_size >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  etag TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'waiting_for_upload', 'uploaded', 'verifying',
      'completed', 'failed', 'expired', 'aborted'
    )
  ),
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT,
  last_error_code TEXT,
  last_error_message TEXT,
  FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_space_id) REFERENCES spaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_parent_node_id) REFERENCES nodes(id) ON DELETE RESTRICT
);
CREATE INDEX blob_upload_sessions_actor
  ON blob_upload_sessions(actor_user_id, created_at DESC, id);
CREATE INDEX blob_upload_sessions_recovery
  ON blob_upload_sessions(state, expires_at, updated_at, id);

CREATE TABLE univer_assets (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  worktree_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  etag TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (worktree_id, unit_id)
    REFERENCES worktree_units(worktree_id, unit_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX univer_assets_trunk_unit
  ON univer_assets(unit_id, created_at, id)
  WHERE worktree_id IS NULL;
CREATE INDEX univer_assets_worktree_unit
  ON univer_assets(worktree_id, unit_id, created_at, id)
  WHERE worktree_id IS NOT NULL;

CREATE TABLE univer_asset_uploads (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL UNIQUE,
  unit_id TEXT NOT NULL,
  worktree_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  actor_user_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  declared_media_type TEXT,
  expected_size BIGINT NOT NULL CHECK (expected_size >= 0),
  received_size BIGINT CHECK (received_size >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  etag TEXT,
  state TEXT NOT NULL CHECK (state IN ('receiving', 'stored')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
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
CREATE INDEX univer_asset_uploads_recovery
  ON univer_asset_uploads(state, expires_at, updated_at, id);

CREATE TABLE object_deletion_jobs (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (
    reason IN (
      'blob_resource_deleted',
      'blob_content_replaced',
      'blob_upload_abandoned',
      'univer_unit_deleted',
      'univer_asset_upload_abandoned',
      'worktree_asset_expired'
    )
  ),
  attempt_count BIGINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at BIGINT NOT NULL,
  lease_owner TEXT,
  lease_expires_at BIGINT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX object_deletion_jobs_due
  ON object_deletion_jobs(next_attempt_at, lease_expires_at, id);

CREATE FUNCTION trash_batches_root_node_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM trash_batches WHERE root_node_id = OLD.id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER trash_batches_root_node_delete
AFTER DELETE ON nodes
FOR EACH ROW EXECUTE FUNCTION trash_batches_root_node_delete();

CREATE FUNCTION nodes_parent_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.parent_id IS NOT NULL) AND (NOT EXISTS (
      SELECT 1
      FROM nodes AS parent
      WHERE parent.id = NEW.parent_id
        AND parent.space_id = NEW.space_id
    )) THEN
    RAISE EXCEPTION 'node parent must be in the same space' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nodes_parent_insert
BEFORE INSERT ON nodes
FOR EACH ROW EXECUTE FUNCTION nodes_parent_insert();

CREATE FUNCTION nodes_parent_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.parent_id IS NOT NULL) AND (NEW.parent_id = NEW.id OR NOT EXISTS (
      SELECT 1
      FROM nodes AS parent
      WHERE parent.id = NEW.parent_id
        AND parent.space_id = NEW.space_id
    )) THEN
    RAISE EXCEPTION 'node parent must be in the same space and not itself' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nodes_parent_update
BEFORE UPDATE OF parent_id, space_id ON nodes
FOR EACH ROW EXECUTE FUNCTION nodes_parent_update();

CREATE FUNCTION space_members_team_only_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NOT EXISTS (
      SELECT 1
      FROM spaces
      WHERE id = NEW.space_id
        AND type = 'team'
        AND owner_user_id <> NEW.user_id
    )) THEN
    RAISE EXCEPTION 'space member must belong to a team space and not be its owner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER space_members_team_only_insert
BEFORE INSERT ON space_members
FOR EACH ROW EXECUTE FUNCTION space_members_team_only_insert();

CREATE FUNCTION node_grants_personal_only_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NOT EXISTS (
      SELECT 1
      FROM nodes AS node
      JOIN spaces AS space ON space.id = node.space_id
      WHERE node.id = NEW.node_id
        AND space.type = 'personal'
        AND space.owner_user_id <> NEW.user_id
    )) THEN
    RAISE EXCEPTION 'node grant must target a personal-space node and not its owner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER node_grants_personal_only_insert
BEFORE INSERT ON node_grants
FOR EACH ROW EXECUTE FUNCTION node_grants_personal_only_insert();

CREATE FUNCTION node_link_sharing_personal_only_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NOT EXISTS (
      SELECT 1
      FROM nodes AS node
      JOIN spaces AS space ON space.id = node.space_id
      WHERE node.id = NEW.node_id
        AND space.type = 'personal'
    )) THEN
    RAISE EXCEPTION 'link sharing must target a personal-space node' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER node_link_sharing_personal_only_insert
BEFORE INSERT ON node_link_sharing
FOR EACH ROW EXECUTE FUNCTION node_link_sharing_personal_only_insert();

CREATE FUNCTION resources_kind_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.kind <> OLD.kind) THEN
    RAISE EXCEPTION 'resource kind is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER resources_kind_immutable
BEFORE UPDATE OF kind ON resources
FOR EACH ROW EXECUTE FUNCTION resources_kind_immutable();

CREATE FUNCTION univer_resources_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (COALESCE(
  (SELECT kind FROM resources WHERE id = NEW.resource_id),
  ''
) <> 'univer') THEN
    RAISE EXCEPTION 'univer extension requires kind=univer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER univer_resources_kind_guard
BEFORE INSERT ON univer_resources
FOR EACH ROW EXECUTE FUNCTION univer_resources_kind_guard();

CREATE FUNCTION blob_resources_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (COALESCE(
  (SELECT kind FROM resources WHERE id = NEW.resource_id),
  ''
) <> 'blob') THEN
    RAISE EXCEPTION 'blob extension requires kind=blob' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER blob_resources_kind_guard
BEFORE INSERT ON blob_resources
FOR EACH ROW EXECUTE FUNCTION blob_resources_kind_guard();

CREATE FUNCTION univer_assets_trunk_unit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.worktree_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
  )) THEN
    RAISE EXCEPTION 'trunk asset requires an existing Univer unit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER univer_assets_trunk_unit_insert
BEFORE INSERT ON univer_assets
FOR EACH ROW EXECUTE FUNCTION univer_assets_trunk_unit_insert();

CREATE FUNCTION univer_assets_trunk_unit_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.worktree_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
  )) THEN
    RAISE EXCEPTION 'trunk asset requires an existing Univer unit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER univer_assets_trunk_unit_update
BEFORE UPDATE OF unit_id, worktree_id ON univer_assets
FOR EACH ROW EXECUTE FUNCTION univer_assets_trunk_unit_update();

CREATE FUNCTION univer_asset_uploads_trunk_unit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.worktree_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM univer_resources WHERE unit_id = NEW.unit_id
  )) THEN
    RAISE EXCEPTION 'trunk asset upload requires an existing Univer unit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER univer_asset_uploads_trunk_unit_insert
BEFORE INSERT ON univer_asset_uploads
FOR EACH ROW EXECUTE FUNCTION univer_asset_uploads_trunk_unit_insert();

CREATE FUNCTION univer_asset_uploads_scope_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'asset upload scope is immutable' USING ERRCODE = '23514';
  RETURN NEW;
END;
$$;
CREATE TRIGGER univer_asset_uploads_scope_update
BEFORE UPDATE OF unit_id, worktree_id ON univer_asset_uploads
FOR EACH ROW EXECUTE FUNCTION univer_asset_uploads_scope_update();

CREATE TABLE content_permission_objects (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES univer_resources(unit_id) ON DELETE CASCADE,
  object_type BIGINT NOT NULL,
  creator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  strategies_json TEXT NOT NULL,
  read_scope BIGINT NOT NULL CHECK (read_scope IN (0, 1, 2)),
  edit_scope BIGINT NOT NULL CHECK (edit_scope IN (0, 1, 2)),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX content_permission_objects_unit ON content_permission_objects(unit_id);
CREATE TABLE content_permission_collaborators (
  object_id TEXT NOT NULL REFERENCES content_permission_objects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role BIGINT NOT NULL CHECK (role IN (0, 1)),
  PRIMARY KEY (object_id, user_id)
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  number BIGINT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  state_reason TEXT CHECK (state_reason IN ('completed', 'not_planned')),
  author_user_id TEXT NOT NULL,
  closed_by_user_id TEXT,
  closed_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  created_via TEXT CHECK (created_via IN ('browser', 'agent')),
  CHECK ((state = 'open' AND state_reason IS NULL AND closed_at IS NULL)
      OR (state = 'closed' AND state_reason IS NOT NULL AND closed_at IS NOT NULL)),
  UNIQUE (space_id, number),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX issues_space_state_created ON issues(space_id, state, created_at DESC, id);
CREATE INDEX issues_space_state_updated ON issues(space_id, state, updated_at DESC, id);
-- issues is created after worktrees, so the Issue link's foreign key is added here.
ALTER TABLE worktrees ADD CONSTRAINT worktrees_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL;
CREATE TABLE issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX issue_comments_issue ON issue_comments(issue_id, created_at, id);
CREATE TABLE issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN (
    'closed', 'reopened', 'renamed',
    'labeled', 'unlabeled', 'assigned', 'unassigned',
    'node_referenced', 'node_unreferenced')),
  payload_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX issue_events_issue ON issue_events(issue_id, created_at, id);
CREATE TABLE issue_labels (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX issue_labels_space_name ON issue_labels(space_id, lower(name COLLATE "C"));
CREATE TABLE issue_label_links (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES issue_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX issue_label_links_label ON issue_label_links(label_id, issue_id);
CREATE TABLE issue_assignees (
  assignment_order BIGINT GENERATED ALWAYS AS IDENTITY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX issue_assignees_user ON issue_assignees(user_id, issue_id);
CREATE TABLE issue_node_refs (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (issue_id, node_id)
);
CREATE INDEX issue_node_refs_node ON issue_node_refs(node_id);

CREATE TABLE space_stars (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

CREATE FUNCTION spaces_slug_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.slug IS NOT NULL AND (NEW.type <> 'team' OR lower(NEW.slug COLLATE "C") = 'personal')) THEN
    RAISE EXCEPTION 'only a team space can have a slug, and personal is reserved' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER spaces_slug_insert
BEFORE INSERT ON spaces
FOR EACH ROW EXECUTE FUNCTION spaces_slug_insert();
CREATE FUNCTION spaces_slug_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.slug IS NOT NULL AND (NEW.type <> 'team' OR lower(NEW.slug COLLATE "C") = 'personal')) THEN
    RAISE EXCEPTION 'only a team space can have a slug, and personal is reserved' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER spaces_slug_update
BEFORE UPDATE OF slug, type ON spaces
FOR EACH ROW EXECUTE FUNCTION spaces_slug_update();

CREATE INDEX space_stars_user ON space_stars(user_id, created_at);
CREATE TABLE space_pins (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  position BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, space_id),
  UNIQUE (user_id, position)
);

CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT
);

CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at BIGINT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT
);
CREATE INDEX oauth_grants_user ON oauth_grants(user_id, created_at DESC);

CREATE TABLE oauth_refresh_history (
  refresh_token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  retired_at BIGINT NOT NULL
);
CREATE INDEX oauth_refresh_history_grant
  ON oauth_refresh_history(grant_id);

CREATE TABLE personal_access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  last_used_at BIGINT,
  revoked_at BIGINT
);
CREATE INDEX personal_access_tokens_user
  ON personal_access_tokens(user_id, created_at DESC);

CREATE TABLE login_sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  write_source TEXT CHECK (write_source IN ('browser', 'agent')),
  issued_for_pat_id TEXT REFERENCES personal_access_tokens(id) ON DELETE CASCADE,
  issued_for_grant_id TEXT REFERENCES oauth_grants(id) ON DELETE CASCADE
    CHECK (issued_for_pat_id IS NULL OR issued_for_grant_id IS NULL),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX login_sessions_user
  ON login_sessions(user_id, created_at DESC);
CREATE INDEX login_sessions_expiry
  ON login_sessions(expires_at);

CREATE INDEX login_sessions_pat
  ON login_sessions(issued_for_pat_id) WHERE issued_for_pat_id IS NOT NULL;
CREATE INDEX login_sessions_grant
  ON login_sessions(issued_for_grant_id) WHERE issued_for_grant_id IS NOT NULL;


CREATE TABLE html_view_drafts (
  id TEXT PRIMARY KEY,                       -- randomUUID; appears in /drafts/<id>
  author_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,             -- client key, scoped to the author
  kind TEXT NOT NULL CHECK (kind IN ('create', 'replace')),
  space_id TEXT NOT NULL,                    -- create: destination; replace: the target's Space at intake
  parent_node_id TEXT,                       -- create only
  name TEXT NOT NULL,                        -- create: final node name; replace: target name at intake (display)
  target_resource_id TEXT,                   -- replace only
  base_etag TEXT,                            -- replace only, unquoted blob_resources.etag at intake
  object_key TEXT NOT NULL UNIQUE,           -- minted at intake; adopted by blob_resources on publish
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),  -- of the request bytes, part of the idempotent intent
  media_type TEXT,                           -- set when state leaves 'receiving'
  stored_etag TEXT,                          -- BlobStore etag; becomes blob_resources.etag for create
  state TEXT NOT NULL CHECK (state IN
    ('receiving', 'pending', 'published', 'rejected', 'expired', 'conflicted', 'superseded')),
  result_node_id TEXT, result_resource_id TEXT, result_etag TEXT,  -- published only
  decided_by TEXT, decided_at BIGINT,
  expires_at BIGINT NOT NULL,               -- receiving: +1h; pending: +7d; terminal: unchanged
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  source_worktree_id TEXT,
  superseded_by TEXT,
  revises_draft_id TEXT,
  UNIQUE (author_user_id, idempotency_key),
  CHECK ((kind = 'create' AND target_resource_id IS NULL AND base_etag IS NULL)
      OR (kind = 'replace' AND target_resource_id IS NOT NULL AND base_etag IS NOT NULL AND parent_node_id IS NULL)),
  CHECK (state IN ('receiving', 'expired') OR media_type IS NOT NULL AND stored_etag IS NOT NULL),
  CHECK ((state = 'published') = (result_resource_id IS NOT NULL)),
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX html_view_drafts_due
  ON html_view_drafts(expires_at, id) WHERE state IN ('receiving', 'pending');
CREATE INDEX html_view_drafts_source_worktree
  ON html_view_drafts(source_worktree_id, expires_at, id) WHERE state = 'pending';

CREATE TABLE skill_drafts (
  id TEXT PRIMARY KEY,
  author_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  intent_sha256 TEXT NOT NULL CHECK (length(intent_sha256) = 64),
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_folder_node_id TEXT,
  files TEXT NOT NULL CHECK ((files IS JSON)),
  base TEXT CHECK (base IS NULL OR (base IS JSON)),
  keep TEXT NOT NULL CHECK ((keep IS JSON)),
  scan TEXT NOT NULL CHECK ((scan IS JSON)),
  review TEXT NOT NULL CHECK ((review IS JSON)),
  source TEXT CHECK (source IS NULL OR (source IS JSON)),
  unverified_review_count BIGINT NOT NULL CHECK (unverified_review_count >= 0),
  state TEXT NOT NULL CHECK (state IN
    ('receiving', 'pending', 'published', 'rejected', 'expired', 'conflicted')),
  result_folder_node_id TEXT,
  decided_by TEXT, decided_at BIGINT,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  UNIQUE (author_user_id, idempotency_key),
  CHECK ((base IS NULL) = (target_folder_node_id IS NULL)),
  CHECK ((state = 'published') = (result_folder_node_id IS NOT NULL)),
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX skill_drafts_due
  ON skill_drafts(expires_at, id) WHERE state IN ('receiving', 'pending');

CREATE TABLE agents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  claimed_at BIGINT,
  origin_label TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL,
  expires_at BIGINT,
  banned_at BIGINT,
  CHECK ((owner_user_id IS NULL) = (claimed_at IS NULL))
);

CREATE TABLE node_reports (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  reporter_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE executor_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at BIGINT NOT NULL
);
