import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import {
  PermissionsRepository,
  type GrantRow,
  type LinkSharingRow,
  type MembershipRow,
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
  ): { readonly users: readonly PublicUser[] };
  listTeamMembers(
    actorUserId: string,
    spaceId: string
  ): {
    readonly owner: PublicUser;
    readonly members: readonly TeamMembership[];
  };
  upsertTeamMember(
    actorUserId: string,
    spaceId: string,
    userId: string,
    input: unknown
  ): TeamMembership;
  removeTeamMember(
    actorUserId: string,
    spaceId: string,
    userId: string
  ): void;
  listNodeGrants(
    actorUserId: string,
    nodeId: string
  ): { readonly grants: readonly NodeGrant[] };
  upsertNodeGrant(
    actorUserId: string,
    nodeId: string,
    userId: string,
    input: unknown
  ): NodeGrant;
  removeNodeGrant(
    actorUserId: string,
    nodeId: string,
    userId: string
  ): { readonly effectiveRole: GrantRole | null };
  getNodeLinkSharing(
    actorUserId: string,
    nodeId: string
  ): NodeLinkSharing;
  updateNodeLinkSharing(
    actorUserId: string,
    nodeId: string,
    input: unknown
  ): NodeLinkSharing;
}

export function createPermissionsModule(options: {
  readonly repository: PermissionsRepository;
  readonly access: AccessResolver;
  readonly now?: () => number;
  readonly onLinkSharingUpdated?: (nodeId: string) => void;
}): PermissionsModule {
  const now = options.now ?? Date.now;

  function manageableTeam(actorUserId: string, spaceId: string) {
    const space = options.access.resolveSpace(actorUserId, spaceId);
    if (!space || space.type !== "team") throw notFound();
    if (!space.capabilities.manageMembers) throw forbidden();
    return space;
  }

  function shareableNode(actorUserId: string, nodeId: string) {
    const node = options.access.resolveNode(actorUserId, nodeId);
    if (!node || node.spaceType !== "personal") throw notFound();
    if (!node.capabilities.share) throw forbidden();
    return node;
  }

  return {
    searchUsers(actorUserId, value) {
      const query = validSearch(value);
      return {
        users: options.repository.searchUsers(query, actorUserId),
      };
    },

    listTeamMembers(actorUserId, spaceId) {
      const space = options.access.resolveSpace(actorUserId, spaceId);
      if (!space || space.type !== "team") throw notFound();
      const owner = options.repository.findUser(space.ownerUserId);
      if (!owner) throw new Error("Team space owner is missing");
      return {
        owner,
        members: options.repository
          .listMembers(spaceId)
          .map(membershipView),
      };
    },

    upsertTeamMember(actorUserId, spaceId, userId, input) {
      const space = manageableTeam(actorUserId, spaceId);
      if (space.ownerUserId === userId) {
        throw conflict("The space owner cannot be a member.");
      }
      requireUser(options.repository, userId);
      const role = validTeamRole(input);
      const existing = options.repository
        .listMembers(spaceId)
        .find((member) => member.user_id === userId);
      if (
        space.role === "admin" &&
        (role === "admin" || existing?.role === "admin")
      ) {
        throw forbidden();
      }
      options.repository.upsertMember({
        spaceId,
        userId,
        role,
        grantedBy: actorUserId,
        now: now(),
      });
      const row = options.repository
        .listMembers(spaceId)
        .find((member) => member.user_id === userId);
      if (!row) throw new Error("Updated membership is missing");
      return membershipView(row);
    },

    removeTeamMember(actorUserId, spaceId, userId) {
      const space = options.access.resolveSpace(actorUserId, spaceId);
      if (!space || space.type !== "team") throw notFound();
      if (
        actorUserId !== userId &&
        !space.capabilities.manageMembers
      ) {
        throw forbidden();
      }
      if (space.ownerUserId === userId) {
        throw conflict("The space owner cannot leave the space.");
      }
      const member = options.repository
        .listMembers(spaceId)
        .find((candidate) => candidate.user_id === userId);
      if (
        actorUserId !== userId &&
        space.role === "admin" &&
        member?.role === "admin"
      ) {
        throw forbidden();
      }
      if (!options.repository.removeMember(spaceId, userId)) throw notFound();
    },

    listNodeGrants(actorUserId, nodeId) {
      shareableNode(actorUserId, nodeId);
      return {
        grants: options.repository
          .listGrants(nodeId)
          .map((row) => grantView(row, nodeId, options.access)),
      };
    },

    upsertNodeGrant(actorUserId, nodeId, userId, input) {
      const node = shareableNode(actorUserId, nodeId);
      if (node.role === "owner" && node.spaceType === "personal") {
        const space = options.access.resolveSpace(actorUserId, node.spaceId);
        if (space?.ownerUserId === userId) {
          throw conflict("The space owner already has access.");
        }
      }
      requireUser(options.repository, userId);
      options.repository.upsertGrant({
        nodeId,
        userId,
        role: validGrantRole(input),
        grantedBy: actorUserId,
        now: now(),
      });
      const row = options.repository.findGrant(nodeId, userId);
      if (!row) throw new Error("Updated grant is missing");
      return grantView(row, nodeId, options.access);
    },

    removeNodeGrant(actorUserId, nodeId, userId) {
      shareableNode(actorUserId, nodeId);
      if (!options.repository.removeGrant(nodeId, userId)) throw notFound();
      const remaining = options.access.resolveNode(userId, nodeId);
      return {
        effectiveRole:
          remaining?.role === "editor" || remaining?.role === "viewer"
            ? remaining.role
            : null,
      };
    },

    getNodeLinkSharing(actorUserId, nodeId) {
      shareableNode(actorUserId, nodeId);
      const row = options.repository.findLinkSharing(nodeId);
      return row ? linkSharingView(row) : defaultLinkSharing();
    },

    updateNodeLinkSharing(actorUserId, nodeId, input) {
      shareableNode(actorUserId, nodeId);
      const settings = validLinkSharing(input);
      const previous = options.repository.findLinkSharing(nodeId);
      options.repository.upsertLinkSharing({
        nodeId,
        ...settings,
        actorUserId,
        now: now(),
      });
      const row = options.repository.findLinkSharing(nodeId);
      if (!row) throw new Error("Updated Link Sharing settings are missing");
      if (
        !previous ||
        previous.enabled !== row.enabled ||
        previous.role !== row.role
      ) {
        options.onLinkSharingUpdated?.(nodeId);
      }
      return linkSharingView(row);
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

function grantView(
  row: GrantRow,
  nodeId: string,
  access: AccessResolver
): NodeGrant {
  const effective = access.resolveNode(row.user_id, nodeId)?.role;
  if (effective !== "editor" && effective !== "viewer") {
    throw new Error("Grant has no effective Node access");
  }
  return {
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
    role: row.role,
    effectiveRole: effective,
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

function linkSharingView(row: LinkSharingRow): NodeLinkSharing {
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

function defaultLinkSharing(): NodeLinkSharing {
  return {
    enabled: false,
    role: "viewer",
    createdBy: null,
    updatedBy: null,
    createdAt: null,
    updatedAt: null,
  };
}

function requireUser(
  repository: PermissionsRepository,
  userId: string
): PublicUser {
  const user = repository.findUser(userId);
  if (!user) throw notFound();
  return user;
}

function validSearch(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("query is required.", "query");
  }
  const query = value.trim();
  if (query.length < 2 || query.length > 100) {
    throw invalidInput(
      "query must contain between 2 and 100 characters.",
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

function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "The current user cannot perform this action."
  );
}

function notFound(): ApplicationError {
  return new ApplicationError(
    "NOT_FOUND",
    404,
    "The resource was not found."
  );
}

function conflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}
