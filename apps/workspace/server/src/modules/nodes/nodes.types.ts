import type {
  AccessRole,
  NodeCapabilities,
  ResourceCapabilities,
  SpaceType,
  UnitType,
} from "../access/index.js";

export interface UniverResourceSummary {
  readonly id: string;
  readonly kind: "univer";
  readonly unitId: string;
  readonly unitType: UnitType;
  readonly capabilities: ResourceCapabilities;
}

export interface BlobResourceSummary {
  readonly id: string;
  readonly kind: "blob";
  readonly mediaType: string;
  readonly byteSize: number;
  readonly availability: import("../access/index.js").BlobAvailability;
  readonly capabilities: ResourceCapabilities;
}

export type ResourceSummary = UniverResourceSummary | BlobResourceSummary;

export interface NodeSummary {
  readonly id: string;
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly resource: ResourceSummary | null;
  readonly hasChildren: boolean;
  readonly updatedAt: string;
  readonly accessRole: AccessRole;
  readonly capabilities: NodeCapabilities;
}

export interface Breadcrumb {
  readonly id: string;
  readonly name: string;
}

export interface SpaceSummary {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
}

export interface NodePage {
  readonly space: SpaceSummary;
  readonly parentNode: NodeSummary | null;
  readonly navigationRootNodeId: string | null;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly nodes: readonly NodeSummary[];
  readonly nextCursor: string | null;
}

export interface NodeResponse {
  readonly node: NodeSummary;
  readonly space: SpaceSummary;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly navigationRootNodeId: string | null;
}
