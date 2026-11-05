import type { WorkspaceDatabase } from "../../db/database.js";
import { spaceAccessColumns, spaceMemberJoin, visibleSpaceSql, type SpaceAccessRow } from "../access/index.js";
import type { SpaceStar, SpaceView } from "./spaces.types.js";

export interface SpaceViewRow extends SpaceAccessRow {
  readonly owner_username: string;
  readonly description: string;
  readonly slug: string | null;
}

export type SpaceListScope = "mine" | "starred" | "explore" | "pins";

const mineSql = `(spaces.owner_user_id = $userId
  OR (spaces.type = 'team' AND space_members.user_id IS NOT NULL))`;
const pinnableSql = `(${mineSql} OR (spaces.public_read = 1 AND EXISTS (
  SELECT 1 FROM space_stars WHERE space_stars.space_id = spaces.id AND space_stars.user_id = $userId
)))`;
const scopes: Record<SpaceListScope, { join: string; where: string; order: string }> = {
  mine: {
    join: "",
    where: mineSql,
    order: `CASE WHEN spaces.type = 'personal' AND spaces.owner_user_id = $userId THEN 0
      WHEN spaces.owner_user_id = $userId THEN 1 ELSE 2 END, spaces.name COLLATE NOCASE, spaces.id`,
  },
  starred: {
    join: "JOIN space_stars ON space_stars.space_id = spaces.id AND space_stars.user_id = $userId",
    where: "1",
    order: "space_stars.created_at DESC, spaces.id",
  },
  explore: {
    join: "",
    where: "spaces.public_read = 1 AND spaces.owner_user_id <> $userId AND space_members.user_id IS NULL",
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

const PERSONAL_SLUG = "personal";

export class SpacesRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  listViews(userId: string, scope: SpaceListScope): SpaceViewRow[] {
    const { join, where, order } = scopes[scope];
    return this._database.connection.prepare(`
      SELECT ${spaceAccessColumns}, users.username AS owner_username, spaces.description, spaces.slug
      FROM spaces
      JOIN users ON users.id = spaces.owner_user_id
      ${spaceMemberJoin}
      ${join}
      WHERE ${visibleSpaceSql} AND ${where}
      ORDER BY ${order}
    `).all({ userId }) as unknown as SpaceViewRow[];
  }

  replacePins(userId: string, spaceIds: readonly string[], createdAt: number): boolean {
    return this._database.transaction((database) => {
      const pinnable = database.prepare(`
        SELECT spaces.id FROM spaces ${spaceMemberJoin}
        WHERE spaces.id IN (SELECT value FROM json_each($ids)) AND ${pinnableSql}
      `).all({ userId, ids: JSON.stringify(spaceIds) });
      if (pinnable.length !== spaceIds.length) return false;
      database.prepare("DELETE FROM space_pins WHERE user_id = ?").run(userId);
      const insert = database.prepare(`
        INSERT INTO space_pins (user_id, space_id, position, created_at) VALUES (?, ?, ?, ?)
      `);
      spaceIds.forEach((spaceId, position) => insert.run(userId, spaceId, position, createdAt));
      return true;
    });
  }

  deletePins(userId: string): void {
    this._database.connection.prepare("DELETE FROM space_pins WHERE user_id = ?").run(userId);
  }

  getOwner(userId: string): SpaceView["owner"] {
    const row = this._database.connection.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
    if (!row) throw new Error("Space owner is missing");
    return row as unknown as SpaceView["owner"];
  }

  getDetails(spaceId: string): { readonly description: string; readonly slug: string | null } {
    const row = this._database.connection
      .prepare("SELECT description, slug FROM spaces WHERE id = ?")
      .get(spaceId) as { description: string; slug: string | null } | undefined;
    if (!row) throw new Error("Space is missing");
    return row;
  }

  /** Resolves `<username>/<slug>`; the personal Space is addressed by the reserved slug `personal`. */
  findIdByFullName(username: string, slug: string): string | null {
    const personal = slug.toLowerCase() === PERSONAL_SLUG;
    const row = this._database.connection
      .prepare(
        `SELECT spaces.id FROM spaces
         JOIN users ON users.id = spaces.owner_user_id
         WHERE users.username = ?
           AND ${personal ? "spaces.type = 'personal'" : "spaces.type = 'team' AND spaces.slug = ?"}`
      )
      .get(...(personal ? [username] : [username, slug])) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** The first free slug for the owner: `base`, then `base-2`, `base-3`, ... */
  freeSlug(ownerUserId: string, base: string): string {
    const taken = this._database.connection.prepare(
      "SELECT 1 FROM spaces WHERE owner_user_id = ? AND slug = ?"
    );
    for (let attempt = 1; ; attempt += 1) {
      const suffix = attempt === 1 ? "" : `-${attempt}`;
      const candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
      if (!taken.get(ownerUserId, candidate)) return candidate;
    }
  }

  slugTaken(ownerUserId: string, slug: string, exceptSpaceId?: string): boolean {
    return Boolean(
      this._database.connection
        .prepare("SELECT 1 FROM spaces WHERE owner_user_id = ? AND slug = ? AND id <> ?")
        .get(ownerUserId, slug, exceptSpaceId ?? "")
    );
  }

  getStar(userId: string, spaceId: string): SpaceStar {
    const row = this._database.connection.prepare(`
      SELECT COUNT(*) AS star_count,
             COALESCE(MAX(user_id = ?), 0) AS starred
      FROM space_stars WHERE space_id = ?
    `).get(userId, spaceId) as { star_count: number; starred: number };
    return { starred: Boolean(row.starred), starCount: row.star_count };
  }

  setStar(userId: string, spaceId: string, starred: boolean, createdAt: number): SpaceStar {
    return this._database.transaction((database) => {
      if (starred) {
        database.prepare(`INSERT INTO space_stars (space_id, user_id, created_at)
          VALUES (?, ?, ?) ON CONFLICT (space_id, user_id) DO NOTHING`).run(spaceId, userId, createdAt);
      } else {
        database.prepare("DELETE FROM space_stars WHERE space_id = ? AND user_id = ?").run(spaceId, userId);
      }
      return this.getStar(userId, spaceId);
    });
  }

  createTeamSpace(input: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly publicRead: boolean;
    readonly ownerUserId: string;
    readonly createdAt: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO spaces
          (id, type, name, slug, public_read, owner_user_id, created_at, updated_at)
         VALUES (?, 'team', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.name,
        input.slug,
        input.publicRead ? 1 : 0,
        input.ownerUserId,
        input.createdAt,
        input.createdAt
      );
  }

  updateName(spaceId: string, name: string, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, updatedAt, spaceId);
  }

  updateSlug(spaceId: string, slug: string, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET slug = ?, updated_at = ? WHERE id = ?")
      .run(slug, updatedAt, spaceId);
  }

  updateDescription(spaceId: string, description: string, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET description = ?, updated_at = ? WHERE id = ?")
      .run(description, updatedAt, spaceId);
  }

  updatePublicRead(spaceId: string, publicRead: boolean, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET public_read = ?, updated_at = ? WHERE id = ?")
      .run(publicRead ? 1 : 0, updatedAt, spaceId);
  }
}
