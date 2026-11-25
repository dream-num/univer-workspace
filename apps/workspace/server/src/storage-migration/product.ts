import type { DatabaseSync } from "node:sqlite";
import type { PoolClient } from "pg";
import { identifier, importTable } from "./rows.js";

// Product V34 → PostgreSQL V14. Keep foreign keys and domain triggers enabled during import.
const tables = [
  "users",
  "password_credentials",
  "external_identities",
  "email_login_codes",
  "spaces",
  "space_members",
  "trash_batches",
  "nodes",
  "resources",
  "univer_resources",
  "blob_resources",
  "node_link_sharing",
  "node_grants",
  "recent_resources",
  "issues",
  "forks",
  "worktrees",
  "worktree_units",
  "worktree_node_intents",
  "operations",
  "blob_upload_sessions",
  "univer_assets",
  "univer_asset_uploads",
  "object_deletion_jobs",
  "content_permission_objects",
  "content_permission_collaborators",
  "issue_comments",
  "issue_events",
  "issue_labels",
  "issue_label_links",
  "issue_assignees",
  "issue_node_refs",
  "issue_verdicts",
  "worktree_checks",
  "space_stars",
  "space_pins",
  "oauth_clients",
  "oauth_grants",
  "oauth_refresh_history",
  "personal_access_tokens",
  "login_sessions",
  "html_view_drafts",
  "skill_drafts",
  "agents",
  "node_reports",
  "executor_access",
];

// Read parents before children so the parent guard trigger and foreign keys stay active.
// A copy can come before its source in that order, so sources are linked once every Node exists.
const nodes = `WITH RECURSIVE tree(id, depth) AS (
  SELECT id, 0 FROM nodes WHERE parent_id IS NULL UNION ALL
  SELECT n.id, t.depth + 1 FROM nodes n JOIN tree t ON t.id = n.parent_id
) SELECT nodes.id, nodes.space_id, nodes.parent_id, nodes.name, nodes.created_by, nodes.trash_batch_id,
  nodes.created_at, nodes.updated_at, NULL AS copied_from_node_id
  FROM tree JOIN nodes USING (id) ORDER BY tree.depth, nodes.id`;
const copies = "SELECT id, copied_from_node_id FROM nodes WHERE copied_from_node_id IS NOT NULL";

export async function importProduct(
  db: DatabaseSync,
  client: PoolClient,
  schema: string,
): Promise<number> {
  const source = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*'")
    .all();
  const tableNames = new Set(source.map((row) => row.name));
  if (tableNames.size !== tables.length || tables.some((table) => !tableNames.has(table))) {
    throw new Error("Source and target product tables differ");
  }
  let total = 0;
  for (const name of tables) {
    let select = "SELECT * FROM " + identifier(name);
    if (name === "nodes") select = nodes;
    if (name === "issue_assignees")
      select = "SELECT rowid AS assignment_order, * FROM issue_assignees";
    const count = await importTable(client, schema, name, db.prepare(select).iterate());
    if (name === "nodes" && count !== db.prepare("SELECT count(*) AS n FROM nodes").get()?.n) {
      throw new Error("Unreachable node in source hierarchy");
    }
    if (name === "nodes") {
      for (const copy of db.prepare(copies).iterate()) {
        const linked = await client.query(
          `UPDATE ${identifier(schema)}.nodes SET copied_from_node_id = $2 WHERE id = $1 RETURNING copied_from_node_id`,
          [copy.id, copy.copied_from_node_id],
        );
        if (linked.rows[0]?.copied_from_node_id !== copy.copied_from_node_id) {
          throw new Error(`Readback differs for the copy source of node ${copy.id}`);
        }
      }
    }
    if (name === "issue_assignees" && count > 0) {
      await client.query(
        "SELECT setval(pg_get_serial_sequence('issue_assignees','assignment_order'), greatest(max(assignment_order), 1)) FROM issue_assignees",
      );
    }
    total += count;
  }
  return total;
}
