import type { DatabaseSync } from "node:sqlite";

export function migrateV18ToV19(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
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
  UNIQUE (author_user_id, idempotency_key),
  CHECK ((kind = 'create' AND target_resource_id IS NULL AND base_etag IS NULL)
      OR (kind = 'replace' AND target_resource_id IS NOT NULL AND base_etag IS NOT NULL AND parent_node_id IS NULL)),
  CHECK (state IN ('receiving', 'expired') OR media_type IS NOT NULL AND stored_etag IS NOT NULL),
  CHECK ((state = 'published') = (result_resource_id IS NOT NULL)),
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS html_view_drafts_due
  ON html_view_drafts(expires_at, id) WHERE state IN ('receiving', 'pending');

PRAGMA user_version = 19;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("V19 migration failed foreign_key_check.");
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("V19 migration failed integrity_check.");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
