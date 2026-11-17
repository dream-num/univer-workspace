import type { AccessRole, BlobAvailability, ResourceKind, SpaceType, UnitType } from "./access.types.js";

export interface ResolvedNodeRow {
  readonly id: string;
  readonly space_id: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly resource_id: string | null;
  readonly resource_kind: ResourceKind | null;
  readonly unit_id: string | null;
  readonly unit_type: UnitType | null;
  readonly blob_media_type: string | null;
  readonly blob_byte_size: number | null;
  readonly blob_availability: BlobAvailability | null;
  readonly has_children: 0 | 1;
  readonly updated_at: number;
  readonly space_type: SpaceType;
  readonly space_name: string;
  /** The requester is the Space owner or the human who claimed the agent that owns it. */
  readonly requester_owns: 0 | 1;
  readonly public_read: 0 | 1;
  readonly member_role: Exclude<AccessRole, "owner"> | null;
  readonly grant_role: "editor" | "viewer" | null;
  readonly grant_navigation_root_id: string | null;
  readonly link_sharing_role: "editor" | "viewer" | null;
  readonly navigation_root_id: string | null;
  /** NULL for a requester without a User row: the anonymous reader. */
  readonly requester_kind: "human" | "agent" | null;
  readonly requester_claimed: 0 | 1 | null;
}

export interface StoredSpaceAccess {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
  readonly ownerUserId: string;
  /** The requester is the owner or the human who claimed the agent that owns the Space. */
  readonly owned: boolean;
  readonly publicRead: boolean;
  readonly memberRole: Exclude<AccessRole, "owner"> | null;
}

export interface ResourceMappingRow {
  readonly resource_id: string;
  readonly node_id: string;
  readonly resource_kind: ResourceKind;
  readonly unit_id: string | null;
  readonly unit_type: UnitType | null;
  readonly object_key: string | null;
  readonly original_filename: string | null;
  readonly media_type: string | null;
  readonly byte_size: number | null;
  readonly sha256: string | null;
  readonly etag: string | null;
  readonly availability: BlobAvailability | null;
}

export type NodeAuthorizationRow = Pick<
  ResolvedNodeRow,
  | "requester_owns"
  | "space_type"
  | "public_read"
  | "member_role"
  | "grant_role"
  | "link_sharing_role"
  | "requester_kind"
  | "requester_claimed"
>;

export type OwnedResourceRow = ResolvedNodeRow & ResourceMappingRow;

export interface AccessRepository {
  findResourceByUnitId(unitId: string): Promise<ResourceMappingRow | null>;
  findResource(resourceId: string): Promise<ResourceMappingRow | null>;
  findRequester(userId: string): Promise<Pick<NodeAuthorizationRow, "requester_kind" | "requester_claimed">>;
  countPersonalFiles(userId: string, operationId: string | null): Promise<number>;
  resolveSpace(userId: string, spaceId: string): Promise<StoredSpaceAccess | null>;
  resolveNode(userId: string, nodeId: string): Promise<ResolvedNodeRow | null>;
  resolveNodeAuthorization(userId: string, nodeId: string): Promise<NodeAuthorizationRow | null>;
  resolveOwnedResources(userId: string, resourceIds: readonly string[]): Promise<OwnedResourceRow[]>;
}
