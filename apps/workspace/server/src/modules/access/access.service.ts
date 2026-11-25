import { ANONYMOUS_USER_ID, principalCategory, type AgentBudget, type PrincipalCategory } from "../identity/index.js";
import { agentBudget, assertCeiling, landsByChecks } from "./ceilings.js";
import type {
  AccessRepository,
  NodeAuthorizationRow,
  ResolvedNodeRow,
  ResourceMappingRow,
  StoredSpaceAccess,
} from "./access.repository.js";
import type {
  AccessRole,
  NodeAccess,
  NodeCapabilities,
  ResourceAccess,
  ResourceContentAccess,
  ResourceCapabilities,
  SpaceAccess,
  SpaceCapabilities,
  SpaceType,
} from "./access.types.js";

export interface AccessResolver {
  resolveResourceContent(userId: string, resourceId: string): Promise<ResourceContentAccess | null>;
  resolveUnitContent(userId: string, unitId: string): Promise<ResourceContentAccess | null>;
  resolveOwnedResources(
    userId: string,
    resourceIds: readonly string[],
  ): Promise<ReadonlyMap<string, ResourceAccess>>;
  resolveSpace(userId: string, spaceId: string): Promise<SpaceAccess | null>;
  resolveNode(userId: string, nodeId: string): Promise<NodeAccess | null>;
  resolveResource(userId: string, resourceId: string): Promise<ResourceAccess | null>;
  resolveUnit(userId: string, unitId: string): Promise<ResourceAccess | null>;
  /** Who the User is, for the ceilings: a service holds a user id, not a session. */
  principalCategory(userId: string): Promise<PrincipalCategory>;
  /**
   * Files the User's Spaces hold or are about to hold, for the quota ceiling. Pass the
   * operation being served so that replaying it does not count its own file a second time.
   */
  countOwnedFiles(userId: string, operationId?: string): Promise<number>;
  /** What the User has used of the budget every agent works within. */
  budget(userId: string): Promise<AgentBudget>;
  /** Refuses a direct Trunk write by an agent the Space's `landing` setting gates; a merge is not one. */
  assertChangesTrunk(userId: string, spaceId: string): Promise<void>;
}

export function createAccessResolver(repository: AccessRepository): AccessResolver {
  async function resolveNode(userId: string, nodeId: string): Promise<NodeAccess | null> {
    return resolveStoredNodeAccess(userId, await repository.resolveNode(userId, nodeId));
  }

  async function resolveMapping(userId: string, mapping: ResourceMappingRow | null): Promise<ResourceAccess | null> {
    if (!mapping) return null;
    return resolveStoredResourceAccess(mapping, await resolveNode(userId, mapping.node_id));
  }

  async function contentAccess(
    userId: string,
    mapping: ResourceMappingRow | null,
  ): Promise<ResourceContentAccess | null> {
    if (!mapping) return null;
    const row = await repository.resolveNodeAuthorization(userId, mapping.node_id);
    return resolveStoredContentAccess(userId, mapping, row);
  }

  return {
    async resolveResourceContent(userId, resourceId) {
      return contentAccess(userId, await repository.findResource(resourceId));
    },
    async resolveUnitContent(userId, unitId) {
      return contentAccess(userId, await repository.findResourceByUnitId(unitId));
    },
    async resolveOwnedResources(userId, resourceIds) {
      const resources = new Map<string, ResourceAccess>();
      if (userId === ANONYMOUS_USER_ID) return resources;
      // The repository checks ownership for every candidate.
      for (const row of await repository.resolveOwnedResources(userId, resourceIds)) {
        const resource = resolveStoredResourceAccess(row, resolveStoredNodeAccess(userId, row));
        if (resource) resources.set(resource.id, resource);
      }
      return resources;
    },
    async resolveSpace(userId, spaceId) {
      const row = await repository.resolveSpace(userId, spaceId);
      if (!row) return null;
      return resolveStoredSpaceAccess(userId, row);
    },
    resolveNode,
    async resolveResource(userId, resourceId) {
      return resolveMapping(userId, await repository.findResource(resourceId));
    },
    async resolveUnit(userId, unitId) {
      return resolveMapping(userId, await repository.findResourceByUnitId(unitId));
    },
    async principalCategory(userId) {
      return requesterCategory(await repository.findRequester(userId));
    },
    countOwnedFiles(userId, operationId) {
      return repository.countOwnedFiles(userId, operationId ?? null);
    },
    async budget(userId) {
      return agentBudget(await repository.readBudget(userId, Date.now()));
    },
    async assertChangesTrunk(userId, spaceId) {
      const space = await repository.resolveSpace(userId, spaceId);
      if (space?.landing !== "checks" || space.owned) return;
      assertCeiling(requesterCategory(await repository.findRequester(userId)), "changeTrunk", { landing: space.landing, owns: space.owned });
    },
  };
}

export function resolveStoredContentAccess(
  userId: string,
  mapping: ResourceMappingRow,
  row: NodeAuthorizationRow | null,
): ResourceContentAccess | null {
  if (!row) return null;
  const { role } = resolvedRoles(userId, row);
  if (!role || !validMapping(mapping)) return null;
  return {
    id: mapping.resource_id,
    kind: mapping.resource_kind,
    role,
    unitId: mapping.unit_id,
    unitType: mapping.unit_type,
    capabilities: resourceCapabilities(role, mapping.resource_kind),
    landsByChecks: landsByChecks(requesterCategory(row), { landing: row.space_landing, owns: Boolean(row.requester_owns) }),
  };
}

/** How a Trunk Unit opens in an editor: read-only where Trunk would refuse the requester's edits, the checks ceiling included. */
export function trunkEditorMode(access: ResourceContentAccess | null): "edit" | "readOnly" {
  return access?.capabilities.editContent && !access.landsByChecks ? "edit" : "readOnly";
}

export function resolveStoredNodeAccess(userId: string, row: ResolvedNodeRow | null): NodeAccess | null {
  if (!row) return null;
  const { regularRole, role } = resolvedRoles(userId, row);
  if (!role) return null;
  const navigationRootNodeId =
    role === "owner" || row.space_type === "team" || Boolean(row.public_read)
      ? null
      : row.navigation_root_id;
  return {
    id: row.id,
    spaceId: row.space_id,
    spaceType: row.space_type,
    spaceName: row.space_name,
    parentNodeId:
      navigationRootNodeId !== null && row.id === navigationRootNodeId ? null : row.parent_id,
    name: row.name,
    resourceId: row.resource_id,
    resourceKind: row.resource_kind,
    unitId: row.unit_id,
    unitType: row.unit_type,
    blobMediaType: row.blob_media_type,
    blobByteSize: row.blob_byte_size,
    blobAvailability: row.blob_availability,
    hasChildren: Boolean(row.has_children),
    updatedAt: row.updated_at,
    role,
    capabilities: mergeNodeCapabilities(
      regularRole
        ? nodeCapabilities(regularRole, row.grant_navigation_root_id === row.id, row.space_type)
        : emptyNodeCapabilities(),
      row.link_sharing_role ? linkSharingNodeCapabilities() : emptyNodeCapabilities(),
    ),
    navigationRootNodeId,
  };
}

export function resolveStoredResourceAccess(
  mapping: ResourceMappingRow,
  node: NodeAccess | null,
): ResourceAccess | null {
  if (!node || node.resourceId !== mapping.resource_id) return null;
  const capabilities = resourceCapabilities(node.role, mapping.resource_kind);
  if (mapping.resource_kind === "univer") {
    if (!mapping.unit_id || !mapping.unit_type) return null;
    return {
      id: mapping.resource_id,
      kind: "univer",
      node,
      unitId: mapping.unit_id,
      unitType: mapping.unit_type,
      capabilities,
    };
  }
  if (
    !mapping.object_key ||
    !mapping.original_filename ||
    !mapping.media_type ||
    mapping.byte_size === null ||
    !mapping.sha256 ||
    !mapping.etag ||
    !mapping.availability
  )
    return null;
  return {
    id: mapping.resource_id,
    kind: "blob",
    node,
    objectKey: mapping.object_key,
    originalFilename: mapping.original_filename,
    mediaType: mapping.media_type,
    byteSize: mapping.byte_size,
    sha256: mapping.sha256,
    etag: mapping.etag,
    availability: mapping.availability,
    capabilities,
  };
}

export function requesterCategory(
  row: Pick<NodeAuthorizationRow, "requester_kind" | "requester_claimed">,
): PrincipalCategory {
  return principalCategory(
    row.requester_kind === "agent"
      ? { kind: "agent", claimed: Boolean(row.requester_claimed) }
      : row.requester_kind && { kind: "human" },
  );
}

export function resolveStoredSpaceAccess(userId: string, row: StoredSpaceAccess): SpaceAccess | null {
  const assignedRole = row.owned ? "owner" : row.memberRole;
  const member = userId !== ANONYMOUS_USER_ID && assignedRole !== null;
  const role = highestRole(
    userId === ANONYMOUS_USER_ID ? null : assignedRole,
    row.publicRead ? "viewer" : null,
  );
  if (!role) return null;
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    ownerUserId: row.ownerUserId,
    publicRead: row.publicRead,
    landing: row.landing,
    role,
    member,
    capabilities: spaceCapabilities(role, { type: row.type, member, proposes: row.proposes }),
  };
}

export function spaceCapabilities(
  role: AccessRole,
  context: { readonly type: SpaceType; readonly member: boolean; readonly proposes: boolean },
): SpaceCapabilities {
  const team = context.type === "team";
  return {
    browseRoot: true,
    createAtRoot: role !== "viewer",
    renameSpace: role === "owner" || role === "admin",
    manageMembers: role === "owner" || role === "admin",
    viewTrash: role === "owner" || role === "admin",
    createIssue: team && context.member,
    triageIssues: team && context.member && role !== "viewer",
    manageIssueLabels: team && context.member && (role === "owner" || role === "admin"),
    propose: context.proposes,
  };
}

export function nodeCapabilities(
  role: AccessRole,
  sharedRoot: boolean,
  spaceType: "personal" | "team",
): NodeCapabilities {
  const canWrite = role !== "viewer";
  return {
    browseChildren: true,
    createChildren: canWrite,
    rename: canWrite,
    move: canWrite && !sharedRoot,
    trash: role === "owner" || role === "admin",
    share: role === "owner" && spaceType === "personal",
  };
}

export function resourceCapabilities(
  role: AccessRole,
  kind: ResourceAccess["kind"] = "univer",
): ResourceCapabilities {
  return {
    openContent: true,
    editContent: role !== "viewer",
    downloadContent: kind === "blob",
  };
}

function linkSharingNodeCapabilities(): NodeCapabilities {
  return {
    browseChildren: true,
    createChildren: false,
    rename: false,
    move: false,
    trash: false,
    share: false,
  };
}

function highestRole(left: AccessRole | null, right: AccessRole | null): AccessRole | null {
  if (!left) return right;
  if (!right) return left;
  const rank: Record<AccessRole, number> = {
    owner: 4,
    admin: 3,
    editor: 2,
    viewer: 1,
  };
  return rank[left] >= rank[right] ? left : right;
}

function emptyNodeCapabilities(): NodeCapabilities {
  return {
    browseChildren: false,
    createChildren: false,
    rename: false,
    move: false,
    trash: false,
    share: false,
  };
}

function mergeNodeCapabilities(left: NodeCapabilities, right: NodeCapabilities): NodeCapabilities {
  return {
    browseChildren: left.browseChildren || right.browseChildren,
    createChildren: left.createChildren || right.createChildren,
    rename: left.rename || right.rename,
    move: left.move || right.move,
    trash: left.trash || right.trash,
    share: left.share || right.share,
  };
}

function resolvedRoles(userId: string, row: NodeAuthorizationRow) {
  const assignedRole =
    row.requester_owns
      ? "owner"
      : row.space_type === "team"
        ? row.member_role
        : row.grant_role;
  const regularRole = highestRole(
    userId === ANONYMOUS_USER_ID ? null : assignedRole,
    row.public_read ? "viewer" : null,
  );
  const requester = requesterCategory(row);
  // The anonymous reader and an unclaimed agent cost nothing to create, so a link never lets them edit.
  const linkRole =
    row.link_sharing_role && (requester === "anonymous" || requester === "agent_unclaimed")
      ? "viewer"
      : row.link_sharing_role;
  const role = highestRole(regularRole, linkRole);
  return { regularRole, role };
}

function validMapping(mapping: ResourceMappingRow): boolean {
  return mapping.resource_kind === "univer"
    ? Boolean(mapping.unit_id && mapping.unit_type)
    : Boolean(
        mapping.object_key &&
        mapping.original_filename &&
        mapping.media_type &&
        mapping.byte_size !== null &&
        mapping.sha256 &&
        mapping.etag &&
        mapping.availability,
      );
}
