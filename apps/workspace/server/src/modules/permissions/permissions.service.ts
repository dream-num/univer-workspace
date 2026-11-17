import { ApplicationError } from "../../middleware/errors.js";
import { recordLoopEvent } from "../../middleware/loop-metrics.js";
import { conflict, notFound, requireManageMembers, requireShare, requireTeam } from "./permissions.policy.js";
import { assertCeiling, type AccessResolver } from "../access/index.js";
import { principalCategory, type PrincipalCategory } from "../identity/index.js";
import type {
  PermissionsRepository,
  GrantRow,
  LinkSharingRow,
  MembershipRow,
  NodeOwnerRow,
} from "./permissions.repository.js";
import type {
  NodeLinkSharing,
  NodeGrant,
  GrantRole,
  PublicUser,
  TeamMembership,
  TeamRole,
} from "./permissions.types.js";

export interface PermissionsModule {
  searchUsers(
    actorUserId: string,
    query: unknown
  ): Promise<{ readonly users: readonly PublicUser[] }>;
  listTeamMembers(
    actorUserId: string,
    spaceId: string
  ): Promise<{
    readonly owner: PublicUser;
    readonly members: readonly TeamMembership[];
  }>;
  upsertTeamMember(
    actorUserId: string,
    spaceId: string,
    userId: string,
    input: unknown
  ): Promise<TeamMembership>;
  removeTeamMember(
    actorUserId: string,
    spaceId: string,
    userId: string
  ): Promise<void>;
  listNodeGrants(
    actorUserId: string,
    nodeId: string
  ): Promise<{ readonly grants: readonly NodeGrant[] }>;
  upsertNodeGrant(
    actorUserId: string,
    nodeId: string,
    userId: string,
    input: unknown
  ): Promise<NodeGrant>;
  removeNodeGrant(
    actorUserId: string,
    nodeId: string,
    userId: string
  ): Promise<{ readonly effectiveRole: GrantRole | null }>;
  getNodeLinkSharing(
    actorUserId: string,
    nodeId: string
  ): Promise<NodeLinkSharing>;
  updateNodeLinkSharing(
    actorUserId: string,
    nodeId: string,
    input: unknown
  ): Promise<NodeLinkSharing>;
  nodeOwnerCategory(nodeId: string): Promise<Exclude<PrincipalCategory, "anonymous">>;
}

export function createPermissionsModule(options: {
  readonly repository: PermissionsRepository;
  readonly access: AccessResolver;
  readonly now?: () => number;
  readonly onLinkSharingUpdated?: (nodeId: string) => void;
  readonly onAccessRevoked?: () => void;
}): PermissionsModule {
  const now = options.now ?? Date.now;

  return {
    async searchUsers(actorUserId, value) {
      assertCeiling(await options.access.principalCategory(actorUserId), "searchUsers", {});
      const query = validSearch(value);
      return {
        users: await options.repository.searchUsers(query, actorUserId),
      };
    },

    async listTeamMembers(actorUserId, spaceId) {
      const space = requireTeam(await options.access.resolveSpace(actorUserId, spaceId));
      const owner = await options.repository.findUser(space.ownerUserId);
      if (!owner) throw new Error("Team space owner is missing");
      return {
        owner,
        members: (await options.repository.listMembers(spaceId)).map(membershipView),
      };
    },

    async upsertTeamMember(actorUserId, spaceId, userId, input) {
      const space = requireManageMembers(await options.access.resolveSpace(actorUserId, spaceId));
      if (space.ownerUserId === userId) {
        throw conflict("The space owner cannot be a member.");
      }
      await requireUser(options.repository, userId);
      assertCeiling(await options.access.principalCategory(actorUserId), "addTeamMember", {
        member: await options.access.principalCategory(userId),
      });
      const role = validTeamRole(input);
      const row = await options.repository.upsertMember({
        spaceId,
        userId,
        role,
        grantedBy: actorUserId,
        now: now(),
      });
      return membershipView(row);
    },

    async removeTeamMember(actorUserId, spaceId, userId) {
      await options.repository.removeMember(actorUserId, spaceId, userId);
      // Reuse the gateway's existing policy invalidation so removed users
      // cannot keep reading a room through an already authenticated socket.
      options.onAccessRevoked?.();
    },

    async listNodeGrants(actorUserId, nodeId) {
      requireShare(await options.access.resolveNode(actorUserId, nodeId));
      return {
        grants: (await options.repository.listGrants(nodeId)).map(grantView),
      };
    },

    async upsertNodeGrant(actorUserId, nodeId, userId, input) {
      requireShare(await options.access.resolveNode(actorUserId, nodeId));
      if (actorUserId === userId) throw conflict("The space owner already has access.");
      await requireUser(options.repository, userId);
      const row = await options.repository.upsertGrant({
        nodeId,
        userId,
        role: validGrantRole(input),
        grantedBy: actorUserId,
        now: now(),
      });
      return grantView(row);
    },

    async removeNodeGrant(actorUserId, nodeId, userId) {
      const effectiveRole = await options.repository.removeGrant(actorUserId, nodeId, userId);
      options.onAccessRevoked?.();
      return { effectiveRole };
    },

    async getNodeLinkSharing(actorUserId, nodeId) {
      requireShare(await options.access.resolveNode(actorUserId, nodeId));
      const row = await options.repository.findLinkSharing(nodeId);
      return {
        ...(row ? linkSharingView(row) : defaultLinkSharing()),
        ...ownerView(await options.repository.findNodeOwner(nodeId)),
      };
    },

    async updateNodeLinkSharing(actorUserId, nodeId, input) {
      requireShare(await options.access.resolveNode(actorUserId, nodeId));
      const settings = validLinkSharing(input);
      const { row, owner, changed, wasEnabled } = await options.repository.upsertLinkSharing({
        nodeId,
        ...settings,
        actorUserId,
        now: now(),
      });
      if (changed) options.onLinkSharingUpdated?.(nodeId);
      const sharing = { ...linkSharingView(row), ...ownerView(owner) };
      if (sharing.enabled !== wasEnabled) {
        recordLoopEvent(
          "workspace.link_sharing",
          { state: sharing.enabled ? "on" : "off", role: sharing.role, owner_category: principalCategory(sharing.owner) },
          { node_id: nodeId, user_id: actorUserId }
        );
      }
      return sharing;
    },

    async nodeOwnerCategory(nodeId) {
      return principalCategory(ownerView(await options.repository.findNodeOwner(nodeId)).owner);
    },
  };
}

function membershipView(row: MembershipRow): TeamMembership {
  return {
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
    role: row.role,
    grantedBy: {
      id: row.granted_by_id,
      username: row.granted_by_username,
      displayName: row.granted_by_display_name,
      avatarUrl: row.granted_by_avatar_url,
    },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function grantView(row: GrantRow): NodeGrant {
  return {
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
    role: row.role,
    effectiveRole: row.effectiveRole,
    grantedBy: {
      id: row.granted_by_id,
      username: row.granted_by_username,
      displayName: row.granted_by_display_name,
      avatarUrl: row.granted_by_avatar_url,
    },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function ownerView(row: NodeOwnerRow): Pick<NodeLinkSharing, "owner" | "expiresAt"> {
  return {
    owner: {
      username: row.username,
      ...(row.kind === "agent"
        ? { kind: "agent", claimed: row.claimed === 1 }
        : { kind: "human" }),
    },
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
  };
}

function linkSharingView(row: LinkSharingRow): Omit<NodeLinkSharing, "owner" | "expiresAt"> {
  return {
    enabled: row.enabled === 1,
    role: row.role,
    createdBy: {
      id: row.created_by_id,
      username: row.created_by_username,
      displayName: row.created_by_display_name,
      avatarUrl: row.created_by_avatar_url,
    },
    updatedBy: {
      id: row.updated_by_id,
      username: row.updated_by_username,
      displayName: row.updated_by_display_name,
      avatarUrl: row.updated_by_avatar_url,
    },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function defaultLinkSharing(): Omit<NodeLinkSharing, "owner" | "expiresAt"> {
  return {
    enabled: false,
    role: "viewer",
    createdBy: null,
    updatedBy: null,
    createdAt: null,
    updatedAt: null,
  };
}

async function requireUser(
  repository: PermissionsRepository,
  userId: string
): Promise<PublicUser> {
  const user = await repository.findUser(userId);
  if (!user) throw notFound();
  return user;
}

function validSearch(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("query is required.", "query");
  }
  const query = value.trim();
  if (query.length < 1 || query.length > 100) {
    throw invalidInput(
      "query must contain between 1 and 100 characters.",
      "query"
    );
  }
  return query;
}

function validTeamRole(input: unknown): TeamRole {
  const role = recordRole(input);
  if (role !== "admin" && role !== "editor" && role !== "viewer") {
    throw invalidInput("role is invalid.", "role");
  }
  return role;
}

function validGrantRole(input: unknown): GrantRole {
  const role = recordRole(input);
  if (role !== "editor" && role !== "viewer") {
    throw invalidInput("role is invalid.", "role");
  }
  return role;
}

function validLinkSharing(input: unknown): {
  readonly enabled: boolean;
  readonly role: GrantRole;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidInput("Link Sharing settings are required.");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") {
    throw invalidInput("enabled must be a boolean.", "enabled");
  }
  const role = record.role;
  if (role !== "editor" && role !== "viewer") {
    throw invalidInput("role is invalid.", "role");
  }
  return { enabled: record.enabled, role };
}

function recordRole(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidInput("A role definition is required.");
  }
  return (input as Record<string, unknown>).role;
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}
