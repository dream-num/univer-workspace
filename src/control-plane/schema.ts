/**
 * Control Plane D1 Database Schema DDL & Auto-Migration / Seeding Engine.
 */
import { hashPassword } from "./auth.ts";

export const CONTROL_PLANE_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
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

CREATE TABLE IF NOT EXISTS login_sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_hash ON login_sessions(secret_hash);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('personal', 'team')),
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  public_read INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);

CREATE TABLE IF NOT EXISTS trash_batches (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  root_node_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  restored_at INTEGER,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
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
  FOREIGN KEY (trash_batch_id) REFERENCES trash_batches(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(space_id, parent_id, trash_batch_id);

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
  unit_type TEXT NOT NULL CHECK (unit_type IN ('sheet', 'doc', 'slide', 'board', 'base')),
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_univer_res_unit ON univer_resources(unit_id);

CREATE TABLE IF NOT EXISTS blob_resources (
  resource_id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  etag TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'ready',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS node_link_sharing (
  node_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recent_resources (
  user_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  last_opened_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, resource_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT,
  creator_user_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'user',
  team_space_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  processed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

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
  byte_size INTEGER NOT NULL,
  received_size INTEGER,
  sha256 TEXT,
  etag TEXT,
  state TEXT NOT NULL DEFAULT 'waiting_for_upload',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  last_error_code TEXT
);
`;

const initializedDbs = new WeakSet<D1Database>();

/**
 * Ensures all D1 tables and indexes exist.
 * Idempotent: can safely run on worker startup.
 */
export async function initControlPlaneSchema(db: D1Database): Promise<void> {
  if (initializedDbs.has(db)) return;

  const statements = CONTROL_PLANE_DDL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    try {
      await db.prepare(stmt).run();
    } catch (err) {
      console.warn("Schema statement execution warning:", err);
    }
  }

  initializedDbs.add(db);
}

/**
 * Seeds a default administrator user and initial personal workspace if empty.
 */
export async function seedControlPlane(db: D1Database): Promise<void> {
  await initControlPlaneSchema(db);

  const existing = await db
    .prepare("SELECT COUNT(*) as count FROM users")
    .first<{ count: number }>();

  if (existing && existing.count > 0) {
    return;
  }

  const now = Date.now();
  const userId = "user_admin";
  const spaceId = "space_personal_admin";
  const nodeId = "node_welcome_sheet";
  const resourceId = "res_welcome_sheet";
  const unitId = "unit_welcome_sheet";

  // 1. Create Default Admin User
  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, "admin", "Administrator", null, now, now)
    .run();

  // 2. Default Password: "password123"
  const passwordHash = await hashPassword("password123");
  await db
    .prepare(
      `INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(userId, passwordHash, now, now)
    .run();

  // 3. Create Personal Space
  await db
    .prepare(
      `INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at, public_read)
       VALUES (?, 'personal', 'Personal Space', ?, ?, ?, 0)`
    )
    .bind(spaceId, userId, now, now)
    .run();

  // 4. Add Space Member
  await db
    .prepare(
      `INSERT INTO space_members (space_id, user_id, role, granted_by, created_at, updated_at)
       VALUES (?, ?, 'admin', ?, ?, ?)`
    )
    .bind(spaceId, userId, userId, now, now)
    .run();

  // 5. Create Welcome Sheet Node
  await db
    .prepare(
      `INSERT INTO nodes (id, space_id, parent_id, name, created_by, trash_batch_id, created_at, updated_at)
       VALUES (?, ?, NULL, 'Welcome Sheet', ?, NULL, ?, ?)`
    )
    .bind(nodeId, spaceId, userId, now, now)
    .run();

  // 6. Create Resource
  await db
    .prepare(
      `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
       VALUES (?, ?, 'univer', ?, ?)`
    )
    .bind(resourceId, nodeId, now, now)
    .run();

  // 7. Create Univer Resource entry
  await db
    .prepare(
      `INSERT INTO univer_resources (resource_id, unit_id, unit_type)
       VALUES (?, ?, 'sheet')`
    )
    .bind(resourceId, unitId)
    .run();
}
