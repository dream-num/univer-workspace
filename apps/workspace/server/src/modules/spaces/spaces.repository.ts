import type { WorkspaceDatabase } from "../../db/database.js";
import type { AccessRole, SpaceType } from "../access/index.js";

export interface DiscoverableSpaceRow {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
  readonly owner_user_id: string;
  readonly public_read: 0 | 1;
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
           spaces.public_read,
           space_members.role AS member_role
         FROM spaces
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

  updatePublicRead(spaceId: string, publicRead: boolean, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET public_read = ?, updated_at = ? WHERE id = ?")
      .run(publicRead ? 1 : 0, updatedAt, spaceId);
  }
}
