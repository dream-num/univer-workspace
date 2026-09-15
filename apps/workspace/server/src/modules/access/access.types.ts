export type SpaceType = "personal" | "team";
export type AccessRole = "owner" | "admin" | "editor" | "viewer";
export type UnitType = "sheet" | "doc" | "slide" | "board" | "base";
export type ResourceKind = "univer" | "blob";
export type BlobAvailability = "ready" | "quarantined";

export interface SpaceCapabilities {
  readonly browseRoot: boolean;
  readonly createAtRoot: boolean;
  readonly renameSpace: boolean;
  readonly manageMembers: boolean;
  readonly viewTrash: boolean;
}

export interface NodeCapabilities {
  readonly browseChildren: boolean;
  readonly createChildren: boolean;
  readonly rename: boolean;
  readonly move: boolean;
  readonly trash: boolean;
  readonly share: boolean;
}

export interface ResourceCapabilities {
  readonly openContent: boolean;
  readonly editContent: boolean;
  readonly downloadContent: boolean;
}

export interface SpaceAccess {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
  readonly ownerUserId: string;
  readonly publicRead: boolean;
  readonly role: AccessRole;
  readonly capabilities: SpaceCapabilities;
}

export interface NodeAccess {
  readonly id: string;
  readonly spaceId: string;
  readonly spaceType: SpaceType;
  readonly spaceName: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly resourceId: string | null;
  readonly resourceKind: ResourceKind | null;
  readonly unitId: string | null;
  readonly unitType: UnitType | null;
  readonly blobMediaType: string | null;
  readonly blobByteSize: number | null;
  readonly blobAvailability: BlobAvailability | null;
  readonly hasChildren: boolean;
  readonly updatedAt: number;
  readonly role: AccessRole;
  readonly capabilities: NodeCapabilities;
  readonly navigationRootNodeId: string | null;
}

interface ResourceAccessBase {
  readonly id: string;
  readonly node: NodeAccess;
  readonly capabilities: ResourceCapabilities;
}

export interface UniverResourceAccess extends ResourceAccessBase {
  readonly kind: "univer";
  readonly unitId: string;
  readonly unitType: UnitType;
}

export interface BlobResourceAccess extends ResourceAccessBase {
  readonly kind: "blob";
  readonly objectKey: string;
  readonly originalFilename: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly etag: string;
  readonly availability: BlobAvailability;
}

export type ResourceAccess = UniverResourceAccess | BlobResourceAccess;
