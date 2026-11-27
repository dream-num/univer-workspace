import { ownsSpaceSql, type SqliteAccessRepository } from "../access/access.repository.js";
import { conflict, forbidden, notFound, requireManageMembers, requireShare, requireTeam } from "../../../modules/permissions/permissions.policy.js";
import type { SqliteDatabase } from "../connection.js";
import type { ExposureGuard } from "../../../modules/access/index.js";
import type { GrantRole, PublicUser, TeamRole } from "../../../modules/permissions/permissions.types.js";
import type {
  MembershipRow,
  GrantRow,
  LinkSharingRow,
  NodeOwnerRow,
  PermissionsRepository,
  PersonalSharingRow,
} from "../../../modules/permissions/permissions.repository.js";

export class SqlitePermissionsRepository implements PermissionsRepository {
  constructor(
    private readonly _database: SqliteDatabase,
    private readonly access: SqliteAccessRepository,
  ) {}

  async findUser(userId: string): Promise<PublicUser | null> {
    const row = this._database.connection
      .prepare(
        `SELECT id, username, display_name, avatar_url
         FROM users
         WHERE id = ?`
      )
      .get(userId) as UserRow | undefined;
    return row ? publicUser(row) : null;
  }

  private requireUser(userId: string): void {
    if (!this._database.connection.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) throw notFound();
  }

  async searchUsers(query: string, excludedUserId: string): Promise<PublicUser[]> {
    const pattern = `%${escapeLike(query)}%`;
    return (
      this._database.connection
        .prepare(
          `SELECT id, username, display_name, avatar_url
           FROM users
           WHERE id <> ?
             AND (kind = 'human' OR EXISTS (SELECT 1 FROM agents WHERE agents.user_id = users.id AND agents.owner_user_id IS NOT NULL AND agents.banned_at IS NULL))
             AND (
               id = ?
               OR username LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
             )
           ORDER BY id = ? DESC, username = ? COLLATE NOCASE DESC,
             username COLLATE NOCASE, id
           LIMIT 20`
        )
        .all(excludedUserId, query, pattern, pattern, query, query) as unknown as UserRow[]
    ).map(publicUser);
  }

  async listMembers(spaceId: string): Promise<MembershipRow[]> {
    return this.readMembers(spaceId);
  }

  private readMembers(spaceId: string, userId?: string): MembershipRow[] {
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
         WHERE membership.space_id = ? ${userId === undefined ? "" : "AND membership.user_id = ?"}
         ORDER BY member.username COLLATE NOCASE, member.id`
      )
      .all(...(userId === undefined ? [spaceId] : [spaceId, userId])) as unknown as MembershipRow[];
  }

  async upsertMember(input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly role: TeamRole;
    readonly grantedBy: string;
    readonly now: number;
  }, guard: ExposureGuard<TeamRole>): Promise<MembershipRow> {
    return this._database.transaction(() => {
      const team = requireManageMembers(this.access.readSpaceAccess(input.grantedBy, input.spaceId));
      if (team.ownerUserId === input.userId) throw conflict("The space owner cannot be a member.");
      this.requireUser(input.userId);
      const before = this.readMembers(input.spaceId, input.userId)[0]?.role ?? null;
      if (team.role === "admin" && (input.role === "admin" || before === "admin")) throw forbidden();
      guard(before);
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
      const member = this.readMembers(input.spaceId, input.userId)[0];
      if (!member) throw new Error("Updated membership is missing");
      return member;
    });
  }

  async removeMember(actorUserId: string, spaceId: string, userId: string): Promise<void> {
    this._database.transaction(() => {
      const team = requireTeam(this.access.readSpaceAccess(actorUserId, spaceId));
      if (actorUserId !== userId && !team.capabilities.manageMembers) throw forbidden();
      if (team.ownerUserId === userId) throw conflict("The space owner cannot leave the space.");
      if (actorUserId !== userId && team.role === "admin" && this.readMembers(spaceId, userId)[0]?.role === "admin") {
        throw forbidden();
      }
      const result = this._database.connection.prepare("DELETE FROM space_members WHERE space_id = ? AND user_id = ?").run(spaceId, userId);
      if (!result.changes) throw notFound();
    });
  }

  async listGrants(nodeId: string): Promise<GrantRow[]> {
    return this.readGrants(nodeId);
  }

  private readGrants(nodeId: string, userId?: string): GrantRow[] {
    const rows = this._database.connection
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
         ORDER BY grantee.username COLLATE NOCASE, grantee.id`
      )
      .all(...(userId === undefined ? [nodeId] : [nodeId, userId])) as unknown as Omit<GrantRow, "effectiveRole">[];
    return rows.map((row) => {
      const effectiveRole = this.effectiveRole(row.user_id, nodeId);
      if (!effectiveRole) throw new Error("Grant has no effective Node access");
      return { ...row, effectiveRole };
    });
  }

  private effectiveRole(userId: string, nodeId: string): GrantRole | null {
    const role = this.access.readNodeAccess(userId, nodeId)?.role;
    return role === "editor" || role === "viewer" ? role : null;
  }

  async upsertGrant(input: {
    readonly nodeId: string;
    readonly userId: string;
    readonly role: GrantRole;
    readonly grantedBy: string;
    readonly now: number;
  }, guard: ExposureGuard<GrantRole>): Promise<GrantRow> {
    return this._database.transaction(() => {
      requireShare(this.access.readNodeAccess(input.grantedBy, input.nodeId));
      if (input.userId === input.grantedBy) throw conflict("The space owner already has access.");
      this.requireUser(input.userId);
      guard(this.readGrants(input.nodeId, input.userId)[0]?.role ?? null);
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
      const grant = this.readGrants(input.nodeId, input.userId)[0];
      if (!grant) throw new Error("Updated grant is missing");
      return grant;
    });
  }

  async removeGrant(actorUserId: string, nodeId: string, userId: string): Promise<GrantRole | null> {
    return this._database.transaction(() => {
      requireShare(this.access.readNodeAccess(actorUserId, nodeId));
      const result = this._database.connection.prepare("DELETE FROM node_grants WHERE node_id = ? AND user_id = ?").run(nodeId, userId);
      if (!result.changes) throw notFound();
      return this.effectiveRole(userId, nodeId);
    });
  }

  async findLinkSharing(nodeId: string): Promise<LinkSharingRow | null> {
    return this.readLinkSharing(nodeId);
  }

  private readLinkSharing(nodeId: string): LinkSharingRow | null {
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

  async listPersonalSharing(readerUserId: string, actorUserId: string, since: number, limit: number) {
    const connection = this._database.connection;
    const owned = Boolean(connection.prepare(`SELECT 1 FROM users WHERE id = ? AND ${ownsSpaceSql("users.id", "?")}`).get(actorUserId, readerUserId, readerUserId));
    const links = connection
      .prepare(
        `SELECT 'link' AS kind, nodes.id AS node_id, nodes.name AS node_name, sharing.role, sharing.enabled, sharing.updated_at
         FROM node_link_sharing AS sharing
         JOIN nodes ON nodes.id = sharing.node_id
         JOIN spaces ON spaces.id = nodes.space_id
         WHERE spaces.type = 'personal' AND spaces.owner_user_id = ?
           AND ((sharing.updated_by = ? AND sharing.updated_at > ?) OR (sharing.created_by = ? AND sharing.created_at > ?))
         ORDER BY sharing.updated_at DESC, nodes.id
         LIMIT ?`
      )
      .all(actorUserId, actorUserId, since, actorUserId, since, limit);
    const grants = connection
      .prepare(
        `SELECT 'grant' AS kind, nodes.id AS node_id, nodes.name AS node_name, grants.role, grants.updated_at,
           grantee.id AS user_id, grantee.username, grantee.display_name, grantee.avatar_url
         FROM node_grants AS grants
         JOIN nodes ON nodes.id = grants.node_id
         JOIN spaces ON spaces.id = nodes.space_id
         JOIN users AS grantee ON grantee.id = grants.user_id
         WHERE spaces.type = 'personal' AND spaces.owner_user_id = ? AND grants.granted_by = ? AND grants.updated_at > ?
         ORDER BY grants.updated_at DESC, nodes.id, grantee.id
         LIMIT ?`
      )
      .all(actorUserId, actorUserId, since, limit);
    return { owned, rows: [...links, ...grants] as unknown as PersonalSharingRow[] };
  }

  async findNodeOwner(nodeId: string): Promise<NodeOwnerRow> {
    return this.readNodeOwner(nodeId);
  }

  private readNodeOwner(nodeId: string): NodeOwnerRow {
    return this._database.connection
      .prepare(
        `SELECT
           owner.username,
           owner.kind,
           agents.owner_user_id IS NOT NULL AS claimed,
           agents.expires_at
         FROM nodes
         JOIN spaces ON spaces.id = nodes.space_id
         JOIN users AS owner ON owner.id = spaces.owner_user_id
         LEFT JOIN agents ON agents.user_id = owner.id
         WHERE nodes.id = ?`
      )
      .get(nodeId) as unknown as NodeOwnerRow;
  }

  async listAgentFilesWithoutLinkSharing(agentUserId: string): Promise<readonly string[]> {
    const rows = this._database.connection
      .prepare(
        `SELECT nodes.id FROM nodes
         JOIN spaces ON spaces.id = nodes.space_id
         JOIN agents ON agents.user_id = spaces.owner_user_id
         WHERE spaces.type = 'personal' AND spaces.owner_user_id = ?
           AND nodes.trash_batch_id IS NULL AND nodes.created_at <= agents.claimed_at
           AND EXISTS (SELECT 1 FROM resources WHERE resources.node_id = nodes.id)
           AND NOT EXISTS (SELECT 1 FROM node_link_sharing WHERE node_link_sharing.node_id = nodes.id)
         ORDER BY nodes.id`
      )
      .all(agentUserId) as unknown as readonly { readonly id: string }[];
    return rows.map((row) => row.id);
  }

  async upsertLinkSharing(input: {
    readonly nodeId: string;
    readonly enabled: boolean;
    readonly role: GrantRole;
    readonly actorUserId: string;
    readonly now: number;
  }, guard: ExposureGuard<GrantRole>): Promise<{ row: LinkSharingRow; owner: NodeOwnerRow; changed: boolean; wasEnabled: boolean }> {
    return this._database.transaction(() => {
      requireShare(this.access.readNodeAccess(input.actorUserId, input.nodeId));
      const before = this.readLinkSharing(input.nodeId);
      const wasEnabled = before?.enabled === 1;
      guard(wasEnabled ? before.role : null);
      const result = this._database.connection
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
      const row = this.readLinkSharing(input.nodeId);
      if (!row) throw new Error("Updated Link Sharing settings are missing");
      return { row, owner: this.readNodeOwner(input.nodeId), changed: result.changes > 0, wasEnabled };
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
