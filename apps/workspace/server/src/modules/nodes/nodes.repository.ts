import type { NodeAccess } from "../access/index.js";
import type { Principal } from "../identity/index.js";

export interface NodePatch {
  readonly name?: string;
  readonly parentNodeId?: string | null;
}

export interface NodeCursor {
  readonly name: string;
  readonly id: string;
}

export interface NodeListRow {
  readonly id: string;
  readonly name: string;
}

export interface BreadcrumbRow {
  readonly id: string;
  readonly name: string;
}

export interface SpaceOwnerRow {
  readonly display_name: string;
  readonly kind: "human" | "agent";
  readonly claimed: 0 | 1;
}

export interface NodesRepository {
  findSpaceOwner(spaceId: string): Promise<SpaceOwnerRow>;
  createReport(input: {
    readonly id: string;
    readonly nodeId: string;
    readonly reporterUserId: string | null;
    readonly reason: string;
    readonly createdAt: number;
  }): Promise<void>;
  createNode(input: {
    readonly id: string;
    readonly spaceId: string;
    readonly parentNodeId: string | null;
    readonly name: string;
    readonly createdBy: string;
    readonly createdAt: number;
  }): Promise<NodeAccess>;
  listChildren(
    spaceId: string,
    parentNodeId: string | null,
    cursor: NodeCursor | null,
    limit: number
  ): Promise<NodeListRow[]>;
  breadcrumbs(nodeId: string): Promise<BreadcrumbRow[]>;
  /** The Node this one was copied from, while that Node still exists. */
  copiedFrom(nodeId: string): Promise<string | null>;
  /** Authorize and apply the patch together so concurrent moves cannot form a cycle. */
  updateNode(actor: Principal, nodeId: string, patch: NodePatch, updatedAt: number): Promise<NodeAccess>;
}
