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

export interface NodesRepository {
  createReport(input: {
    readonly id: string;
    readonly nodeId: string;
    readonly reporterUserId: string | null;
    readonly reason: string;
    readonly createdAt: number;
  }): void;
  createNode(input: {
    readonly id: string;
    readonly spaceId: string;
    readonly parentNodeId: string | null;
    readonly name: string;
    readonly createdBy: string;
    readonly createdAt: number;
  }): void;
  listChildren(
    spaceId: string,
    parentNodeId: string | null,
    cursor: NodeCursor | null,
    limit: number
  ): NodeListRow[];
  breadcrumbs(nodeId: string): BreadcrumbRow[];
  isSelfOrDescendant(nodeId: string, candidateId: string): boolean;
  updateNode(input: {
    readonly nodeId: string;
    readonly name: string;
    readonly parentNodeId: string | null;
    readonly updatedAt: number;
  }): void;
}
