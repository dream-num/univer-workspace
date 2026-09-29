import type { DatabaseSync } from "node:sqlite";

/** Add Space-scoped Issues without rewriting existing tables or rows. */
export function migrateV8ToV9(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  state_reason TEXT CHECK (state_reason IN ('completed', 'not_planned')),
  author_user_id TEXT NOT NULL,
  closed_by_user_id TEXT,
  closed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((state = 'open' AND state_reason IS NULL AND closed_at IS NULL)
      OR (state = 'closed' AND state_reason IS NOT NULL AND closed_at IS NOT NULL)),
  UNIQUE (space_id, number),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX issues_space_state_created ON issues(space_id, state, created_at DESC, id);
CREATE INDEX issues_space_state_updated ON issues(space_id, state, updated_at DESC, id);
CREATE TABLE issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL
);
CREATE INDEX issue_events_issue ON issue_events(issue_id, created_at, id);
CREATE TABLE issue_labels (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX issue_labels_space_name ON issue_labels(space_id, name COLLATE NOCASE);
CREATE TABLE issue_label_links (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES issue_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX issue_label_links_label ON issue_label_links(label_id, issue_id);
CREATE TABLE issue_assignees (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX issue_assignees_user ON issue_assignees(user_id, issue_id);
CREATE TABLE issue_node_refs (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issue_id, node_id)
);
CREATE INDEX issue_node_refs_node ON issue_node_refs(node_id);
PRAGMA user_version = 9;
    `);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("V9 migration failed foreign_key_check.");
    }
    if (database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
      throw new Error("V9 migration failed integrity_check.");
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
