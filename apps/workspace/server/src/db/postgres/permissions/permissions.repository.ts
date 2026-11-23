import type { PostgresAccessRepository } from "../access/access.repository.js";
import { conflict, forbidden, notFound, requireManageMembers, requireShare, requireTeam } from "../../../modules/permissions/permissions.policy.js";
import type { PostgresDatabase } from "../connection.js";
import type { GrantRole, PublicUser, TeamRole } from "../../../modules/permissions/permissions.types.js";
import type {
  MembershipRow,
  GrantRow,
  LinkSharingRow,
  NodeOwnerRow,
  PermissionsRepository,
} from "../../../modules/permissions/permissions.repository.js";

export class PostgresPermissionsRepository implements PermissionsRepository {
  constructor(
    private readonly _database: PostgresDatabase,
    private readonly access: PostgresAccessRepository,
  ) {}

  async findUser(userId: string): Promise<PublicUser | null> {
    const row = await this._database
      .prepare(
        `SELECT id, username, display_name, avatar_url
         FROM users
         WHERE id = ?`
      )
      .get(userId) as UserRow | undefined;
    return row ? publicUser(row) : null;
  }

  private async requireUser(userId: string): Promise<void> {
    if (!await this._database.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) throw notFound();
  }

  async searchUsers(query: string, excludedUserId: string): Promise<PublicUser[]> {
    const pattern = `%${escapeLike(query)}%`;
    return (
      await this._database
        .prepare(
          `SELECT id, username, display_name, avatar_url
           FROM users
           WHERE id <> ?
             AND (kind = 'human' OR EXISTS (SELECT 1 FROM agents WHERE agents.user_id = users.id AND agents.owner_user_id IS NOT NULL))
             AND (
               id = ?
               OR username ILIKE ? ESCAPE '\\'
               OR display_name ILIKE ? ESCAPE '\\'
             )
           ORDER BY id = ? DESC, lower(username COLLATE "C") = lower(?::text COLLATE "C") DESC,
             lower(username COLLATE "C"), id
           LIMIT 20`
        )
        .all(excludedUserId, query, pattern, pattern, query, query) as unknown as UserRow[]
    ).map(publicUser);
  }

  async listMembers(spaceId: string): Promise<MembershipRow[]> {
    return await this.readMembers(spaceId);
  }

  private async readMembers(spaceId: string, userId?: string): Promise<MembershipRow[]> {
    return await this._database
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
         WHERE membership.space_id = ? ${userId === undefined ? "" : "AND membership.user_id = ?"}
         ORDER BY lower(member.username COLLATE "C"), member.id`
      )
      .all(...(userId === undefined ? [spaceId] : [spaceId, userId])) as unknown as MembershipRow[];
  }

  async upsertMember(input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly role: TeamRole;
    readonly grantedBy: string;
    readonly now: number;
  }): Promise<MembershipRow> {
    return await this._database.transaction(async () => {
      const team = requireManageMembers(await this.access.readSpaceAccess(input.grantedBy, input.spaceId));
      if (team.ownerUserId === input.userId) throw conflict("The space owner cannot be a member.");
      await this.requireUser(input.userId);
      if (team.role === "admin" && (input.role === "admin" || (await this.readMembers(input.spaceId, input.userId))[0]?.role === "admin")) {
        throw forbidden();
      }
      await this._database
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
      const member = (await this.readMembers(input.spaceId, input.userId))[0];
      if (!member) throw new Error("Updated membership is missing");
      return member;
    });
  }

  async removeMember(actorUserId: string, spaceId: string, userId: string): Promise<void> {
    await this._database.transaction(async () => {
      const team = requireTeam(await this.access.readSpaceAccess(actorUserId, spaceId));
      if (actorUserId !== userId && !team.capabilities.manageMembers) throw forbidden();
      if (team.ownerUserId === userId) throw conflict("The space owner cannot leave the space.");
      if (actorUserId !== userId && team.role === "admin" && (await this.readMembers(spaceId, userId))[0]?.role === "admin") {
        throw forbidden();
      }
      const result = await this._database.prepare("DELETE FROM space_members WHERE space_id = ? AND user_id = ?").run(spaceId, userId);
      if (!result.changes) throw notFound();
    });
  }

  async listGrants(nodeId: string): Promise<GrantRow[]> {
    return await this.readGrants(nodeId);
  }

  private async readGrants(nodeId: string, userId?: string): Promise<GrantRow[]> {
    const rows = await this._database
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
         WHERE grant_node.node_id = ? ${userId === undefined ? "" : "AND grant_node.user_id = ?"}
         ORDER BY lower(grantee.username COLLATE "C"), grantee.id`
      )
      .all(...(userId === undefined ? [nodeId] : [nodeId, userId])) as unknown as Omit<GrantRow, "effectiveRole">[];
    return Promise.all(rows.map(async (row) => {
      const effectiveRole = await this.effectiveRole(row.user_id, nodeId);
      if (!effectiveRole) throw new Error("Grant has no effective Node access");
      return { ...row, effectiveRole };
    }));
  }

  private async effectiveRole(userId: string, nodeId: string): Promise<GrantRole | null> {
    const role = (await this.access.readNodeAccess(userId, nodeId))?.role;
    return role === "editor" || role === "viewer" ? role : null;
  }

  async upsertGrant(input: {
    readonly nodeId: string;
    readonly userId: string;
    readonly role: GrantRole;
    readonly grantedBy: string;
    readonly now: number;
  }): Promise<GrantRow> {
    return await this._database.transaction(async () => {
      requireShare(await this.access.readNodeAccess(input.grantedBy, input.nodeId));
      if (input.userId === input.grantedBy) throw conflict("The space owner already has access.");
      await this.requireUser(input.userId);
      await this._database
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
      const grant = (await this.readGrants(input.nodeId, input.userId))[0];
      if (!grant) throw new Error("Updated grant is missing");
      return grant;
    });
  }

  async removeGrant(actorUserId: string, nodeId: string, userId: string): Promise<GrantRole | null> {
    return await this._database.transaction(async () => {
      requireShare(await this.access.readNodeAccess(actorUserId, nodeId));
      const result = await this._database.prepare("DELETE FROM node_grants WHERE node_id = ? AND user_id = ?").run(nodeId, userId);
      if (!result.changes) throw notFound();
      return await this.effectiveRole(userId, nodeId);
    });
  }

  async findLinkSharing(nodeId: string): Promise<LinkSharingRow | null> {
    return await this.readLinkSharing(nodeId);
  }

  private async readLinkSharing(nodeId: string): Promise<LinkSharingRow | null> {
    return (
      (await this._database
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

  async findNodeOwner(nodeId: string): Promise<NodeOwnerRow> {
    return await this.readNodeOwner(nodeId);
  }

  private async readNodeOwner(nodeId: string): Promise<NodeOwnerRow> {
    return await this._database
      .prepare(
        `SELECT
           owner.username,
           owner.kind,
           (agents.owner_user_id IS NOT NULL)::integer AS claimed,
           agents.expires_at
         FROM nodes
         JOIN spaces ON spaces.id = nodes.space_id
         JOIN users AS owner ON owner.id = spaces.owner_user_id
         LEFT JOIN agents ON agents.user_id = owner.id
         WHERE nodes.id = ?`
      )
      .get(nodeId) as unknown as NodeOwnerRow;
  }

  async upsertLinkSharing(input: {
    readonly nodeId: string;
    readonly enabled: boolean;
    readonly role: GrantRole;
    readonly actorUserId: string;
    readonly now: number;
  }): Promise<{ row: LinkSharingRow; owner: NodeOwnerRow; changed: boolean; wasEnabled: boolean }> {
    return await this._database.transaction(async () => {
      requireShare(await this.access.readNodeAccess(input.actorUserId, input.nodeId));
      const wasEnabled = (await this.readLinkSharing(input.nodeId))?.enabled === 1;
      const result = await this._database
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
      const row = await this.readLinkSharing(input.nodeId);
      if (!row) throw new Error("Updated Link Sharing settings are missing");
      return { row, owner: await this.readNodeOwner(input.nodeId), changed: result.changes > 0, wasEnabled };
    });
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
