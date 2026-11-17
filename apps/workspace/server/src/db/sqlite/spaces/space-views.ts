import type { SqliteDatabase } from "../connection.js";
import {
  ownsSpaceSql, spaceAccessColumns, spaceMemberJoin, storedSpaceAccess, visibleSpaceSql, type SqliteSpaceAccessRow,
} from "../access/access.repository.js";
import type { SpaceListScope, SpaceListEntry } from "../../../modules/spaces/spaces.repository.js";

const ownedSql = ownsSpaceSql("spaces.owner_user_id");
const mineSql = `(${ownedSql} OR (spaces.type = 'team' AND space_members.user_id IS NOT NULL))`;

export const pinnableSql = `(${mineSql} OR (spaces.public_read = 1 AND EXISTS (
  SELECT 1 FROM space_stars WHERE space_stars.space_id = spaces.id AND space_stars.user_id = $userId
)))`;

const scopes: Record<SpaceListScope | "pins", { join: string; where: string; order: string }> = {
  mine: {
    join: "",
    where: mineSql,
    order: `CASE WHEN spaces.type = 'personal' AND spaces.owner_user_id = $userId THEN 0
      WHEN ${ownedSql} THEN 1 ELSE 2 END, spaces.name COLLATE NOCASE, spaces.id`,
  },
  starred: {
    join: "JOIN space_stars ON space_stars.space_id = spaces.id AND space_stars.user_id = $userId",
    where: "1",
    order: "space_stars.created_at DESC, spaces.id",
  },
  explore: {
    join: "",
    where: `spaces.public_read = 1 AND NOT ${ownedSql} AND space_members.user_id IS NULL`,
    // ponytail: Explore is unpaginated; add pagination when instance size requires it.
    order: `(SELECT COUNT(*) FROM space_stars WHERE space_stars.space_id = spaces.id) DESC,
      spaces.name COLLATE NOCASE, spaces.id`,
  },
  pins: {
    join: "JOIN space_pins ON space_pins.space_id = spaces.id AND space_pins.user_id = $userId",
    where: pinnableSql,
    order: "space_pins.position",
  },
};

const selectSpaceView = `
  SELECT ${spaceAccessColumns}, users.username AS ownerUsername, spaces.description, spaces.slug
  FROM spaces
  JOIN users ON users.id = spaces.owner_user_id
  ${spaceMemberJoin}`;

type SpaceViewRow = SqliteSpaceAccessRow & Pick<SpaceListEntry, "description" | "slug" | "ownerUsername">;

function storedSpaceView(row: SpaceViewRow): SpaceListEntry {
  return { ...storedSpaceAccess(row), description: row.description, slug: row.slug, ownerUsername: row.ownerUsername };
}

export function findSpaceView(database: SqliteDatabase, userId: string, key: { spaceId: string } | { username: string; slug: string }): SpaceListEntry | null {
  const where = "spaceId" in key ? "spaces.id = $spaceId" : `users.username = $username AND (
    (spaces.type = 'team' AND spaces.slug = $slug) OR (spaces.type = 'personal' AND $slug = 'personal' COLLATE NOCASE)
  )`;
  const row = database.connection.prepare(`
    ${selectSpaceView} WHERE ${visibleSpaceSql} AND ${where}
  `).get({ userId, ...key }) as SpaceViewRow | undefined;
  return row ? storedSpaceView(row) : null;
}

export function listSpaceViews(database: SqliteDatabase, userId: string, scope: SpaceListScope | "pins", limit = -1): SpaceListEntry[] {
  const { join, where, order } = scopes[scope];
  const rows = database.connection.prepare(`
    ${selectSpaceView}
    ${join}
    WHERE ${visibleSpaceSql} AND ${where}
    ORDER BY ${order}
    LIMIT $limit
  `).all({ userId, limit }) as unknown as SpaceViewRow[];
  return rows.map(storedSpaceView);
}
