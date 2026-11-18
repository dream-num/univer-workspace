import type { SqliteDatabase } from "../connection.js";
import { ownerSuspendedSql, ownsSpaceSql, spaceMemberJoin, visibleSpaceSql } from "../access/access.repository.js";
import type {
  RecentCursor,
  RecentRow,
  OwnedRow,
  BreadcrumbRow,
  SharedRow,
  ViewsRepository,
} from "../../../modules/views/views.repository.js";

export class SqliteViewsRepository implements ViewsRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  async listRecent(userId: string, cursor: RecentCursor | null, limit: number): Promise<RecentRow[]> {
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
           AND EXISTS (
             SELECT 1 FROM resources AS resource
             JOIN nodes AS node ON node.id = resource.node_id
             WHERE resource.id = recent_resources.resource_id
               AND node.trash_batch_id IS NULL
           )
           ${cursorClause}
         ORDER BY last_opened_at DESC, resource_id
         LIMIT ?`,
      )
      .all(...parameters) as unknown as RecentRow[];
  }

  async listHtmlViews(userId: string, cursor: RecentCursor | null, limit: number, spaceId?: string): Promise<OwnedRow[]> {
    const cursorClause =
      cursor === null
        ? ""
        : `AND (
             node.updated_at < $cursorTimestamp
             OR (node.updated_at = $cursorTimestamp AND resource.id > $cursorId)
           )`;
    const candidateSpaces =
      spaceId === undefined
        ? `SELECT id FROM spaces WHERE owner_user_id = $userId
           UNION
           SELECT spaces.id FROM agents JOIN spaces ON spaces.owner_user_id = agents.user_id
           WHERE agents.owner_user_id = $userId
           UNION
           SELECT space_id FROM space_members WHERE user_id = $userId`
        : "SELECT id FROM spaces WHERE id = $spaceId";
    const mySpaces =
      spaceId === undefined
        ? `AND (${ownsSpaceSql("spaces.owner_user_id")} OR (spaces.type = 'team' AND space_members.user_id IS NOT NULL))`
        : "";
    // CROSS JOIN fixes the loop order. Without table statistics SQLite would otherwise scan every node or Blob.
    return this._database.connection
      .prepare(
        `WITH RECURSIVE granted(id, space_id) AS (
           SELECT node.id, node.space_id
           FROM node_grants AS grant_node
           JOIN nodes AS node ON node.id = grant_node.node_id
           JOIN spaces ON spaces.id = node.space_id
           WHERE grant_node.user_id = $userId
             AND spaces.type = 'personal'
             AND NOT ${ownerSuspendedSql("spaces.owner_user_id")}
           UNION
           SELECT child.id, child.space_id
           FROM granted
           JOIN nodes AS child ON child.space_id = granted.space_id AND child.parent_id = granted.id
         ),
         candidate_spaces(id) AS (${candidateSpaces}),
         reach(id) AS (
           SELECT space_node.id
           FROM candidate_spaces
           JOIN spaces ON spaces.id = candidate_spaces.id
           ${spaceMemberJoin}
           CROSS JOIN nodes AS space_node ON space_node.space_id = spaces.id
           WHERE ${visibleSpaceSql} ${mySpaces}
           UNION
           SELECT id FROM granted
         )
         SELECT resource.id AS resource_id, node.updated_at
         FROM reach
         CROSS JOIN nodes AS node ON node.id = reach.id
         JOIN resources AS resource ON resource.node_id = node.id
         JOIN blob_resources AS blob ON blob.resource_id = resource.id
         WHERE node.trash_batch_id IS NULL
           AND lower(blob.original_filename) LIKE '%.univer.html'
           ${spaceId === undefined ? "" : "AND node.space_id = $spaceId"}
           ${cursorClause}
         ORDER BY node.updated_at DESC, resource.id
         LIMIT $limit`,
      )
      .all({
        userId,
        limit,
        ...(spaceId === undefined ? {} : { spaceId }),
        ...(cursor === null ? {} : { cursorTimestamp: cursor.timestamp, cursorId: cursor.id }),
      }) as unknown as OwnedRow[];
  }

  async listOwned(userId: string, cursor: RecentCursor | null, limit: number): Promise<OwnedRow[]> {
    const cursorClause =
      cursor === null
        ? ""
        : `AND (
             node.updated_at < ?
             OR (node.updated_at = ? AND resource.id > ?)
           )`;
    const parameters =
      cursor === null
        ? [userId, userId, limit]
        : [userId, userId, cursor.timestamp, cursor.timestamp, cursor.id, limit];
    return this._database.connection
      .prepare(
        `SELECT resource.id AS resource_id, node.updated_at
         FROM resources AS resource
         JOIN nodes AS node ON node.id = resource.node_id
         JOIN spaces AS space ON space.id = node.space_id
         WHERE ${ownsSpaceSql("space.owner_user_id", "?")}
           AND node.trash_batch_id IS NULL
           ${cursorClause}
         ORDER BY node.updated_at DESC, resource.id
         LIMIT ?`,
      )
      .all(...parameters) as unknown as OwnedRow[];
  }

  async breadcrumbs(nodeId: string): Promise<BreadcrumbRow[]> {
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
         SELECT id, name FROM ancestry ORDER BY depth DESC`,
      )
      .all(nodeId) as unknown as BreadcrumbRow[];
  }

  async listShared(userId: string, cursor: RecentCursor | null, limit: number): Promise<SharedRow[]> {
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
         LIMIT ?`,
      )
      .all(...parameters) as unknown as SharedRow[];
  }
}
