import type { WorkspaceDatabase } from "../../db/database.js";
import type { AccessRole, SpaceType } from "../access/index.js";
import type { SpaceStar, SpaceView } from "./spaces.types.js";

export interface DiscoverableSpaceRow {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
  readonly owner_user_id: string;
  readonly owner_username: string;
  readonly public_read: 0 | 1;
  readonly description: string;
  readonly member_role: Exclude<AccessRole, "owner"> | null;
}

export class SpacesRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  listDiscoverable(userId: string): DiscoverableSpaceRow[] {
    return this._database.connection
      .prepare(
        `SELECT
           spaces.id,
           spaces.type,
           spaces.name,
           spaces.owner_user_id,
           users.username AS owner_username,
           spaces.public_read,
           spaces.description,
           space_members.role AS member_role
         FROM spaces
         JOIN users ON users.id = spaces.owner_user_id
         LEFT JOIN space_members
           ON space_members.space_id = spaces.id
          AND space_members.user_id = ?
         WHERE spaces.owner_user_id = ?
            OR (spaces.type = 'team' AND space_members.user_id IS NOT NULL)
            OR spaces.public_read = 1
         ORDER BY
           CASE
             WHEN spaces.type = 'personal' AND spaces.owner_user_id = ? THEN 0
             WHEN spaces.owner_user_id = ? THEN 1
             ELSE 2
           END,
           spaces.name COLLATE NOCASE,
           spaces.id`
      )
      .all(userId, userId, userId, userId) as unknown as DiscoverableSpaceRow[];
  }

  getOwner(userId: string): SpaceView["owner"] {
    const row = this._database.connection.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
    if (!row) throw new Error("Space owner is missing");
    return row as unknown as SpaceView["owner"];
  }

  getDescription(spaceId: string): string {
    const row = this._database.connection
      .prepare("SELECT description FROM spaces WHERE id = ?")
      .get(spaceId) as { description: string } | undefined;
    if (!row) throw new Error("Space is missing");
    return row.description;
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
    readonly publicRead: boolean;
    readonly ownerUserId: string;
    readonly createdAt: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO spaces
          (id, type, name, public_read, owner_user_id, created_at, updated_at)
         VALUES (?, 'team', ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.name,
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
