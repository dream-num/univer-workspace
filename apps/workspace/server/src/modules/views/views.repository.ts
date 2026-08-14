import type { WorkspaceDatabase } from "../../db/database.js";

export interface RecentCursor {
  readonly timestamp: number;
  readonly id: string;
}

export interface RecentRow {
  readonly resource_id: string;
  readonly last_opened_at: number;
}

export interface OwnedRow {
  readonly resource_id: string;
  readonly updated_at: number;
}

export interface BreadcrumbRow {
  readonly id: string;
  readonly name: string;
}

export interface SharedRow {
  readonly node_id: string;
  readonly shared_at: number;
  readonly shared_by_id: string;
  readonly shared_by_username: string;
  readonly shared_by_display_name: string;
  readonly shared_by_avatar_url: string | null;
}

export class ViewsRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  listRecent(
    userId: string,
    cursor: RecentCursor | null,
    limit: number
  ): RecentRow[] {
    const cursorClause =
      cursor === null
        ? ""
        : `AND (
             last_opened_at < ?
             OR (last_opened_at = ? AND resource_id > ?)
           )`;
    const parameters =
      cursor === null
        ? [userId, limit]
        : [userId, cursor.timestamp, cursor.timestamp, cursor.id, limit];
    return this._database.connection
      .prepare(
        `SELECT resource_id, last_opened_at
         FROM recent_resources
         WHERE user_id = ?
           ${cursorClause}
         ORDER BY last_opened_at DESC, resource_id
         LIMIT ?`
      )
      .all(...parameters) as unknown as RecentRow[];
  }

  listOwned(
    userId: string,
    cursor: RecentCursor | null,
    limit: number
  ): OwnedRow[] {
    const cursorClause =
      cursor === null
        ? ""
        : `AND (
             node.updated_at < ?
             OR (node.updated_at = ? AND resource.id > ?)
           )`;
    const parameters =
      cursor === null
        ? [userId, limit]
        : [userId, cursor.timestamp, cursor.timestamp, cursor.id, limit];
    return this._database.connection
      .prepare(
        `SELECT resource.id AS resource_id, node.updated_at
         FROM resources AS resource
         JOIN nodes AS node ON node.id = resource.node_id
         JOIN spaces AS space ON space.id = node.space_id
         WHERE space.owner_user_id = ?
           AND node.trash_batch_id IS NULL
           ${cursorClause}
         ORDER BY node.updated_at DESC, resource.id
         LIMIT ?`
      )
      .all(...parameters) as unknown as OwnedRow[];
  }

  breadcrumbs(nodeId: string): BreadcrumbRow[] {
    return this._database.connection
      .prepare(
        `WITH RECURSIVE ancestry(id, parent_id, name, depth) AS (
           SELECT id, parent_id, name, 0
           FROM nodes
           WHERE id = ? AND trash_batch_id IS NULL
           UNION ALL
           SELECT parent.id, parent.parent_id, parent.name, ancestry.depth + 1
           FROM nodes AS parent
           JOIN ancestry ON ancestry.parent_id = parent.id
           WHERE parent.trash_batch_id IS NULL
         )
         SELECT id, name FROM ancestry ORDER BY depth DESC`
      )
      .all(nodeId) as unknown as BreadcrumbRow[];
  }

  listShared(
    userId: string,
    cursor: RecentCursor | null,
    limit: number
  ): SharedRow[] {
    const cursorClause =
      cursor === null
        ? ""
        : `AND (
             grant_node.created_at < ?
             OR (
               grant_node.created_at = ?
               AND grant_node.node_id > ?
             )
           )`;
    const parameters =
      cursor === null
        ? [userId, limit]
        : [userId, cursor.timestamp, cursor.timestamp, cursor.id, limit];
    return this._database.connection
      .prepare(
        `SELECT
           grant_node.node_id,
           grant_node.created_at AS shared_at,
           grantor.id AS shared_by_id,
           grantor.username AS shared_by_username,
           grantor.display_name AS shared_by_display_name,
           grantor.avatar_url AS shared_by_avatar_url
         FROM node_grants AS grant_node
         JOIN nodes AS node ON node.id = grant_node.node_id
         JOIN users AS grantor ON grantor.id = grant_node.granted_by
         WHERE grant_node.user_id = ?
           AND node.trash_batch_id IS NULL
           ${cursorClause}
         ORDER BY grant_node.created_at DESC, grant_node.node_id
         LIMIT ?`
      )
      .all(...parameters) as unknown as SharedRow[];
  }
}
