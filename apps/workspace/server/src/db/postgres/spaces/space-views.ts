import type { Pool, PoolClient } from "pg";
import type { SpaceListEntry, SpaceListScope } from "../../../modules/spaces/spaces.repository.js";
import type { SpaceStar } from "../../../modules/spaces/spaces.types.js";
import { ownsSpaceSql } from "../access/access.repository.js";

type Connection = Pool | PoolClient;

const memberJoin = `LEFT JOIN space_members
  ON space_members.space_id = spaces.id AND space_members.user_id = $1`;
const mine = `(spaces.owner_user_id = $1 OR (spaces.type = 'team' AND space_members.user_id IS NOT NULL))`;
const owned = ownsSpaceSql("spaces.owner_user_id", "$1");
const visible = `(${owned} OR (
  NOT EXISTS (
    SELECT 1 FROM agents WHERE agents.user_id = spaces.owner_user_id
      AND (agents.banned_at IS NOT NULL OR agents.expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)
  ) AND ((spaces.type = 'team' AND space_members.user_id IS NOT NULL) OR spaces.public_read)
))`;
const starred = `EXISTS (SELECT 1 FROM space_stars WHERE space_stars.space_id = spaces.id AND space_stars.user_id = $1)`;
const pinnable = `(${mine} OR (spaces.public_read AND ${starred}))`;
const starCount = `(SELECT COUNT(*) FROM space_stars WHERE space_stars.space_id = spaces.id)`;
// SQLite NOCASE folds only ASCII. The C collation also preserves its bytewise tie-break on IDs.
const nameOrder = 'lower(spaces.name COLLATE "C"), spaces.id COLLATE "C"';

const scopes: Record<SpaceListScope | "pins", { join: string; where: string; order: string }> = {
  mine: {
    join: "",
    where: mine,
    order: `CASE WHEN spaces.type = 'personal' AND spaces.owner_user_id = $1 THEN 0
      WHEN spaces.owner_user_id = $1 THEN 1 ELSE 2 END, ${nameOrder}`,
  },
  starred: {
    join: "JOIN space_stars ON space_stars.space_id = spaces.id AND space_stars.user_id = $1",
    where: "true",
    order: 'space_stars.created_at DESC, spaces.id COLLATE "C"',
  },
  explore: {
    join: "",
    where: "spaces.public_read AND spaces.owner_user_id <> $1 AND space_members.user_id IS NULL",
    order: `${starCount} DESC, ${nameOrder}`,
  },
  pins: {
    join: "JOIN space_pins ON space_pins.space_id = spaces.id AND space_pins.user_id = $1",
    where: pinnable,
    order: "space_pins.position",
  },
};

const selectSpaceView = `
  SELECT spaces.id, spaces.type, spaces.name, spaces.owner_user_id AS "ownerUserId", ${owned} AS "owned",
    spaces.public_read AS "publicRead", space_members.role AS "memberRole",
    users.username AS "ownerUsername", spaces.description, spaces.slug
  FROM spaces JOIN users ON users.id = spaces.owner_user_id
  ${memberJoin}`;

export async function listSpaceViews(
  db: Connection, userId: string, scope: SpaceListScope | "pins", limit?: number,
): Promise<SpaceListEntry[]> {
  const { join, where, order } = scopes[scope];
  const { rows } = await db.query<SpaceListEntry>(`
    ${selectSpaceView} ${join}
    WHERE ${visible} AND ${where} ORDER BY ${order} LIMIT $2`,
    [userId, limit === undefined || limit < 0 ? null : limit],
  );
  return rows;
}

export async function findSpaceView(
  db: Connection, userId: string, key: { spaceId: string } | { username: string; slug: string },
): Promise<SpaceListEntry | null> {
  const byId = "spaceId" in key;
  const filter = byId ? "spaces.id = $2" : `
    lower(users.username COLLATE "C") = lower($2::text COLLATE "C") AND (
      (spaces.type = 'team' AND lower(spaces.slug COLLATE "C") = lower($3::text COLLATE "C"))
      OR (spaces.type = 'personal' AND lower($3::text COLLATE "C") = 'personal')
    )`;
  const { rows } = await db.query<SpaceListEntry>(`${selectSpaceView} WHERE ${visible} AND ${filter}`,
    byId ? [userId, key.spaceId] : [userId, key.username, key.slug],
  );
  return rows[0] ?? null;
}

export async function pinnableSpaceIds(db: Connection, userId: string, ids: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(`
    SELECT spaces.id FROM spaces ${memberJoin}
    WHERE spaces.id = ANY($2::text[]) AND ${visible} AND ${pinnable}`, [userId, ids]);
  return rows.map((row) => row.id);
}

export async function readSpaceStar(db: Connection, userId: string, spaceId: string): Promise<SpaceStar | null> {
  const { rows } = await db.query<{ starred: boolean; count: string }>(`
    SELECT ${starred} AS starred, ${starCount} AS count
    FROM spaces ${memberJoin}
    WHERE spaces.id = $2 AND ${visible}`, [userId, spaceId]);
  const row = rows[0];
  return row ? { starred: row.starred, starCount: Number(row.count) } : null;
}
