import { AccessRepository } from "./access.repository.js";
import type {
  AccessRole,
  NodeAccess,
  NodeCapabilities,
  ResourceAccess,
  ResourceCapabilities,
  SpaceAccess,
  SpaceCapabilities,
} from "./access.types.js";

export interface AccessResolver {
  resolveSpace(userId: string, spaceId: string): SpaceAccess | null;
  resolveNode(userId: string, nodeId: string): NodeAccess | null;
  resolveResource(userId: string, resourceId: string): ResourceAccess | null;
  resolveUnit(userId: string, unitId: string): ResourceAccess | null;
}

export function createAccessResolver(
  repository: AccessRepository
): AccessResolver {
  function resolveNode(userId: string, nodeId: string): NodeAccess | null {
    const row = repository.resolveNode(userId, nodeId);
    if (!row) return null;
    const assignedRole =
      row.owner_user_id === userId
        ? "owner"
        : row.space_type === "team"
          ? row.member_role
          : row.grant_role;
    const regularRole = highestRole(
      assignedRole,
      row.public_read ? "viewer" : null
    );
    const role = highestRole(regularRole, row.link_sharing_role);
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
        navigationRootNodeId !== null &&
        row.id === navigationRootNodeId
          ? null
          : row.parent_id,
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
          ? nodeCapabilities(
              regularRole,
              row.grant_navigation_root_id === row.id,
              row.space_type
            )
          : emptyNodeCapabilities(),
        row.link_sharing_role
          ? linkSharingNodeCapabilities()
          : emptyNodeCapabilities()
      ),
      navigationRootNodeId,
    };
  }

  function resourceAccess(
    userId: string,
    mapping: {
      readonly resource_id: string;
      readonly node_id: string;
      readonly resource_kind: ResourceAccess["kind"];
      readonly unit_id: string | null;
      readonly unit_type: import("./access.types.js").UnitType | null;
      readonly object_key: string | null;
      readonly original_filename: string | null;
      readonly media_type: string | null;
      readonly byte_size: number | null;
      readonly sha256: string | null;
      readonly etag: string | null;
      readonly availability: import("./access.types.js").BlobAvailability | null;
    } | null
  ): ResourceAccess | null {
    if (!mapping) return null;
    const node = resolveNode(userId, mapping.node_id);
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
    ) return null;
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

  return {
    resolveSpace(userId, spaceId) {
      const row = repository.resolveSpace(userId, spaceId);
      if (!row) return null;
      const role = highestRole(
        row.owner_user_id === userId ? "owner" : row.member_role,
        row.public_read ? "viewer" : null
      );
      if (!role) return null;
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        ownerUserId: row.owner_user_id,
        publicRead: Boolean(row.public_read),
        role,
        capabilities: spaceCapabilities(role),
      };
    },
    resolveNode,
    resolveResource(userId, resourceId) {
      return resourceAccess(userId, repository.findResource(resourceId));
    },
    resolveUnit(userId, unitId) {
      return resourceAccess(userId, repository.findResourceByUnitId(unitId));
    },
  };
}

export function spaceCapabilities(role: AccessRole): SpaceCapabilities {
  return {
    browseRoot: true,
    createAtRoot: role !== "viewer",
    renameSpace: role === "owner" || role === "admin",
    manageMembers: role === "owner" || role === "admin",
    viewTrash: role === "owner" || role === "admin",
  };
}

export function nodeCapabilities(
  role: AccessRole,
  sharedRoot: boolean,
  spaceType: "personal" | "team"
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
  kind: ResourceAccess["kind"] = "univer"
): ResourceCapabilities {
  return {
    openContent: true,
    editContent: kind === "univer" && role !== "viewer",
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

function highestRole(
  left: AccessRole | null,
  right: AccessRole | null
): AccessRole | null {
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

function mergeNodeCapabilities(
  left: NodeCapabilities,
  right: NodeCapabilities
): NodeCapabilities {
  return {
    browseChildren: left.browseChildren || right.browseChildren,
    createChildren: left.createChildren || right.createChildren,
    rename: left.rename || right.rename,
    move: left.move || right.move,
    trash: left.trash || right.trash,
    share: left.share || right.share,
  };
}
