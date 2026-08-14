import type {
  NodeSummary,
  ResourceSummary,
} from "../nodes/index.js";
import type { PublicUser } from "../permissions/index.js";

export interface RecentResourceItem {
  readonly lastOpenedAt: string;
  readonly node: NodeSummary;
  readonly resource: ResourceSummary;
  readonly location: {
    readonly space: {
      readonly id: string;
      readonly type: "personal" | "team";
      readonly name: string;
    };
    readonly breadcrumbs: readonly {
      readonly id: string;
      readonly name: string;
    }[];
  };
}

export interface RecentResourceList {
  readonly items: readonly RecentResourceItem[];
  readonly nextCursor: string | null;
}

export interface OwnedResourceItem {
  readonly node: NodeSummary;
  readonly resource: ResourceSummary;
  readonly location: RecentResourceItem["location"];
}

export interface OwnedResourceList {
  readonly items: readonly OwnedResourceItem[];
  readonly nextCursor: string | null;
}

export interface SharedItem {
  readonly node: NodeSummary;
  readonly sharedBy: PublicUser;
  readonly sharedAt: string;
}

export interface SharedList {
  readonly items: readonly SharedItem[];
  readonly nextCursor: string | null;
}
