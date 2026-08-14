import type { WorkspaceDatabase } from "../../db/database.js";
import type {
  GrantRole,
  PublicUser,
  TeamRole,
} from "./permissions.types.js";

export interface MembershipRow {
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly role: TeamRole;
  readonly granted_by_id: string;
  readonly granted_by_username: string;
  readonly granted_by_display_name: string;
  readonly granted_by_avatar_url: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface GrantRow {
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly role: GrantRole;
  readonly granted_by_id: string;
  readonly granted_by_username: string;
  readonly granted_by_display_name: string;
  readonly granted_by_avatar_url: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface LinkSharingRow {
  readonly enabled: 0 | 1;
  readonly role: GrantRole;
  readonly created_by_id: string;
  readonly created_by_username: string;
  readonly created_by_display_name: string;
  readonly created_by_avatar_url: string | null;
  readonly updated_by_id: string;
  readonly updated_by_username: string;
  readonly updated_by_display_name: string;
  readonly updated_by_avatar_url: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export class PermissionsRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  findUser(userId: string): PublicUser | null {
    const row = this._database.connection
      .prepare(
        `SELECT id, username, display_name, avatar_url
         FROM users
         WHERE id = ?`
      )
      .get(userId) as UserRow | undefined;
    return row ? publicUser(row) : null;
  }

  searchUsers(query: string, excludedUserId: string): PublicUser[] {
    const pattern = `%${escapeLike(query)}%`;
    return (
      this._database.connection
        .prepare(
          `SELECT id, username, display_name, avatar_url
           FROM users
           WHERE id <> ?
             AND (
               username LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
             )
           ORDER BY username COLLATE NOCASE, id
           LIMIT 20`
        )
        .all(excludedUserId, pattern, pattern) as unknown as UserRow[]
    ).map(publicUser);
  }

  listMembers(spaceId: string): MembershipRow[] {
    return this._database.connection
      .prepare(
        `SELECT
           member.id AS user_id,
           member.username,
           member.display_name,
           member.avatar_url,
           membership.role,
           grantor.id AS granted_by_id,
           grantor.username AS granted_by_username,
           grantor.display_name AS granted_by_display_name,
           grantor.avatar_url AS granted_by_avatar_url,
           membership.created_at,
           membership.updated_at
         FROM space_members AS membership
         JOIN users AS member ON member.id = membership.user_id
         JOIN users AS grantor ON grantor.id = membership.granted_by
         WHERE membership.space_id = ?
         ORDER BY member.username COLLATE NOCASE, member.id`
      )
      .all(spaceId) as unknown as MembershipRow[];
  }

  upsertMember(input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly role: TeamRole;
    readonly grantedBy: string;
    readonly now: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO space_members
           (space_id, user_id, role, granted_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (space_id, user_id)
         DO UPDATE SET
           role = excluded.role,
           granted_by = excluded.granted_by,
           updated_at = excluded.updated_at`
      )
      .run(
        input.spaceId,
        input.userId,
        input.role,
        input.grantedBy,
        input.now,
        input.now
      );
  }

  removeMember(spaceId: string, userId: string): boolean {
    return (
      this._database.connection
        .prepare(
          "DELETE FROM space_members WHERE space_id = ? AND user_id = ?"
        )
        .run(spaceId, userId).changes > 0
    );
  }

  listGrants(nodeId: string): GrantRow[] {
    return this._database.connection
      .prepare(
        `SELECT
           grantee.id AS user_id,
           grantee.username,
           grantee.display_name,
           grantee.avatar_url,
           grant_node.role,
           grantor.id AS granted_by_id,
           grantor.username AS granted_by_username,
           grantor.display_name AS granted_by_display_name,
           grantor.avatar_url AS granted_by_avatar_url,
           grant_node.created_at,
           grant_node.updated_at
         FROM node_grants AS grant_node
         JOIN users AS grantee ON grantee.id = grant_node.user_id
         JOIN users AS grantor ON grantor.id = grant_node.granted_by
         WHERE grant_node.node_id = ?
         ORDER BY grantee.username COLLATE NOCASE, grantee.id`
      )
      .all(nodeId) as unknown as GrantRow[];
  }

  findGrant(nodeId: string, userId: string): GrantRow | null {
    return this.listGrants(nodeId).find((row) => row.user_id === userId) ?? null;
  }

  upsertGrant(input: {
    readonly nodeId: string;
    readonly userId: string;
    readonly role: GrantRole;
    readonly grantedBy: string;
    readonly now: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO node_grants
           (node_id, user_id, role, granted_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (node_id, user_id)
         DO UPDATE SET
           role = excluded.role,
           granted_by = excluded.granted_by,
           updated_at = excluded.updated_at`
      )
      .run(
        input.nodeId,
        input.userId,
        input.role,
        input.grantedBy,
        input.now,
        input.now
      );
  }

  removeGrant(nodeId: string, userId: string): boolean {
    return (
      this._database.connection
        .prepare(
          `DELETE FROM node_grants
           WHERE node_id = ? AND user_id = ?`
        )
        .run(nodeId, userId).changes > 0
    );
  }

  findLinkSharing(nodeId: string): LinkSharingRow | null {
    return (
      (this._database.connection
        .prepare(
          `SELECT
             link_sharing.enabled,
             link_sharing.role,
             creator.id AS created_by_id,
             creator.username AS created_by_username,
             creator.display_name AS created_by_display_name,
             creator.avatar_url AS created_by_avatar_url,
             updater.id AS updated_by_id,
             updater.username AS updated_by_username,
             updater.display_name AS updated_by_display_name,
             updater.avatar_url AS updated_by_avatar_url,
             link_sharing.created_at,
             link_sharing.updated_at
           FROM node_link_sharing AS link_sharing
           JOIN users AS creator ON creator.id = link_sharing.created_by
           JOIN users AS updater ON updater.id = link_sharing.updated_by
           WHERE link_sharing.node_id = ?`
        )
        .get(nodeId) as LinkSharingRow | undefined) ?? null
    );
  }

  upsertLinkSharing(input: {
    readonly nodeId: string;
    readonly enabled: boolean;
    readonly role: GrantRole;
    readonly actorUserId: string;
    readonly now: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO node_link_sharing
           (
             node_id,
             enabled,
             role,
             created_by,
             updated_by,
             created_at,
             updated_at
           )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (node_id)
         DO UPDATE SET
           enabled = excluded.enabled,
           role = excluded.role,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at
         WHERE node_link_sharing.enabled <> excluded.enabled
            OR node_link_sharing.role <> excluded.role`
      )
      .run(
        input.nodeId,
        input.enabled ? 1 : 0,
        input.role,
        input.actorUserId,
        input.actorUserId,
        input.now,
        input.now
      );
  }
}

interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
}

export function publicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
