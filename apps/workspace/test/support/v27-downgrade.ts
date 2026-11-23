import { DROP_V28_SQL, withoutV28Columns } from "./v28-downgrade.js";

export const DROP_V27_SQL = `${DROP_V28_SQL}
ALTER TABLE html_view_drafts RENAME TO html_view_drafts_v27;
DROP INDEX html_view_drafts_due;
DROP INDEX html_view_drafts_source_worktree;
CREATE TABLE IF NOT EXISTS html_view_drafts (
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
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),  -- of the request bytes, part of the idempotent intent
  media_type TEXT,                           -- set when state leaves 'receiving'
  stored_etag TEXT,                          -- BlobStore etag; becomes blob_resources.etag for create
  state TEXT NOT NULL CHECK (state IN
    ('receiving', 'pending', 'published', 'rejected', 'expired', 'conflicted')),
  result_node_id TEXT, result_resource_id TEXT, result_etag TEXT,  -- published only
  decided_by TEXT, decided_at INTEGER,
  expires_at INTEGER NOT NULL,               -- receiving: +1h; pending: +7d; terminal: unchanged
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  source_worktree_id TEXT,
  UNIQUE (author_user_id, idempotency_key),
  CHECK ((kind = 'create' AND target_resource_id IS NULL AND base_etag IS NULL)
      OR (kind = 'replace' AND target_resource_id IS NOT NULL AND base_etag IS NOT NULL AND parent_node_id IS NULL)),
  CHECK (state IN ('receiving', 'expired') OR media_type IS NOT NULL AND stored_etag IS NOT NULL),
  CHECK ((state = 'published') = (result_resource_id IS NOT NULL)),
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS html_view_drafts_due
  ON html_view_drafts(expires_at, id) WHERE state IN ('receiving', 'pending');
CREATE INDEX IF NOT EXISTS html_view_drafts_source_worktree
  ON html_view_drafts(source_worktree_id, expires_at, id) WHERE state = 'pending';

INSERT INTO html_view_drafts (id, author_user_id, idempotency_key, kind, space_id, parent_node_id, name, target_resource_id, base_etag, object_key, byte_size, sha256, media_type, stored_etag, state, result_node_id, result_resource_id, result_etag, decided_by, decided_at, expires_at, created_at, updated_at, source_worktree_id) SELECT id, author_user_id, idempotency_key, kind, space_id, parent_node_id, name, target_resource_id, base_etag, object_key, byte_size, sha256, media_type, stored_etag, state, result_node_id, result_resource_id, result_etag, decided_by, decided_at, expires_at, created_at, updated_at, source_worktree_id FROM html_view_drafts_v27;
DROP TABLE html_view_drafts_v27;
`;

export function withoutV27Columns(table: string, rows: readonly Record<string, unknown>[]) {
  return withoutV28Columns(table, rows).map((row) => {
    const rest = { ...row };
    if (table === "html_view_drafts") {
      delete rest.superseded_by;
      delete rest.revises_draft_id;
    }
    return rest;
  });
}
