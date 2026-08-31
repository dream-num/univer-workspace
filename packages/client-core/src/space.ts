import {
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  workspaceError,
} from "./errors.js";
import {
  parseDetachedNode,
  parseNodePage,
  parseNodeResponse,
  parseSpace,
  parseTrashBatch,
  type WorkspaceNode,
  type WorkspaceNodeSummary,
  type WorkspaceNodeResource,
  type WorkspaceSpace,
  type WorkspaceTrashBatch,
  type WorkspaceUnitType,
} from "./space-model.js";
import type { AuthenticatedWorkspaceHttp, WorkspaceHttp } from "./http.js";

export type WorkspaceResourceKindFilter = WorkspaceNodeResource["kind"] | "none";
export interface BrowseSpaceInput {
  readonly parentNodeId?: string;
  readonly recursive?: boolean;
  readonly resourceKind?: WorkspaceResourceKindFilter;
  readonly spaceId: string;
  readonly unitType?: WorkspaceUnitType;
}

export class WorkspaceSpaceFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async list(signal?: AbortSignal): Promise<readonly WorkspaceSpace[]> {
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    const body = await http.json("/api/spaces", signal === undefined ? {} : { signal });
    if (!Array.isArray(body["spaces"]))
      throw invalidResponse("Workspace response is missing Spaces");
    return body["spaces"].map(parseSpace);
  }

  public async browse(input: BrowseSpaceInput, signal?: AbortSignal): Promise<readonly WorkspaceNode[]> {
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    const visited = new Set<string>(input.parentNodeId === undefined ? [] : [input.parentNodeId]);
    const visit = async (parentNodeId: string | undefined): Promise<readonly WorkspaceNode[]> => {
      signal?.throwIfAborted();
      const nodes = await listDirectory(http, input.spaceId, parentNodeId, signal);
      const discovered: WorkspaceNode[] = [];
      for (const node of nodes) {
        if (visited.has(node.nodeId)) {
          throw invalidResponse("Workspace Node directory contains a repeated or cyclic Node.");
        }
        visited.add(node.nodeId);
        if (matches(node, input.resourceKind, input.unitType)) discovered.push(node);
        if (input.recursive === true && node.hasChildren) {
          signal?.throwIfAborted();
          discovered.push(...(await visit(node.nodeId)));
        }
      }
      return discovered;
    };
    return await visit(input.parentNodeId);
  }

  public async find(
    input: Omit<BrowseSpaceInput, "recursive"> & { readonly query: string },
    signal?: AbortSignal,
  ): Promise<readonly WorkspaceNode[]> {
    const query = input.query.trim().toLowerCase();
    if (query === "")
      throw workspaceError("workspace-argument-invalid", "Space find query is required.");
    return (await this.browse({ ...input, recursive: true }, signal)).filter((node) =>
      node.name.toLowerCase().includes(query),
    );
  }

  public async createNode(input: {
    readonly name: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
  }, signal?: AbortSignal): Promise<WorkspaceNodeSummary> {
    const name = normalizedNodeName(input.name);
    let body: Record<string, unknown>;
    try {
      const http = await this.authenticatedHttp(signal);
      signal?.throwIfAborted();
      body = await http.json("/api/nodes", {
        body: { name, parentNodeId: input.parentNodeId ?? null, spaceId: input.spaceId },
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (!isWorkspaceResultUnknown(error)) throw error;
      throw new WorkspaceApplicationError(
        "workspace-result-unknown",
        "Node creation may have completed. Run space browse for the target directory before deciding whether to retry.",
        {
          cause: error instanceof Error ? error.message : String(error),
          name,
          parentNodeId: input.parentNodeId ?? null,
          spaceId: input.spaceId,
        },
        { cause: error },
      );
    }
    const node = parseDetachedNode(body);
    if (node.resource !== null || node.name !== name) {
      throw invalidResponse(
        "Workspace Node response does not match the requested organizational Node.",
      );
    }
    if (node.spaceId !== input.spaceId || node.parentNodeId !== (input.parentNodeId ?? null)) {
      throw invalidResponse(
        "Workspace Node response does not match the requested organizational Node target.",
      );
    }
    return node;
  }

  public async renameNode(input: {
    readonly name: string;
    readonly nodeId: string;
  }, signal?: AbortSignal): Promise<WorkspaceNodeSummary> {
    const name = normalizedNodeName(input.name);
    return await this.updateNode({ kind: "rename", name, nodeId: input.nodeId }, signal);
  }

  public async moveNode(input: {
    readonly nodeId: string;
    readonly parentNodeId: string | null;
  }, signal?: AbortSignal): Promise<WorkspaceNodeSummary> {
    return await this.updateNode({
      kind: "move",
      nodeId: input.nodeId,
      parentNodeId: input.parentNodeId,
    }, signal);
  }

  public async trashNode(nodeId: string, signal?: AbortSignal): Promise<WorkspaceTrashBatch> {
    let body: Record<string, unknown>;
    try {
      const http = await this.authenticatedHttp(signal);
      signal?.throwIfAborted();
      body = await http.json(`/api/nodes/${encodeURIComponent(nodeId)}/trash`, {
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (!isWorkspaceResultUnknown(error)) throw error;
      throw new WorkspaceApplicationError(
        "workspace-result-unknown",
        "The Node may have been moved to Trash. Do not retry blindly because the Trash Batch identity could not be confirmed.",
        { cause: error instanceof Error ? error.message : String(error), nodeId },
        { cause: error },
      );
    }
    return parseTrashBatch(body, nodeId);
  }

  private async updateNode(
    input:
      | { readonly kind: "rename"; readonly name: string; readonly nodeId: string }
      | {
          readonly kind: "move";
          readonly nodeId: string;
          readonly parentNodeId: string | null;
        },
    signal?: AbortSignal,
  ): Promise<WorkspaceNodeSummary> {
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    const patch =
      input.kind === "rename" ? { name: input.name } : { parentNodeId: input.parentNodeId };
    try {
      const updated = parseDetachedNode(
        await http.json(`/api/nodes/${encodeURIComponent(input.nodeId)}`, {
          body: patch,
          method: "PATCH",
          ...(signal === undefined ? {} : { signal }),
        }),
      );
      assertUpdatedNode(updated, input);
      return updated;
    } catch (error) {
      if (!isWorkspaceResultUnknown(error)) throw error;
      let current: WorkspaceNode;
      try {
        signal?.throwIfAborted();
        current = parseNodeResponse(
          await http.json(
            `/api/nodes/${encodeURIComponent(input.nodeId)}`,
            signal === undefined ? {} : { signal },
          ),
          input.nodeId,
        );
      } catch (readError) {
        throw new WorkspaceApplicationError(
          "workspace-result-unknown",
          "The Workspace Node update may have completed, but current Node metadata could not confirm it.",
          {
            cause: error instanceof Error ? error.message : String(error),
            nodeId: input.nodeId,
            readCause: readError instanceof Error ? readError.message : String(readError),
            requested: patch,
          },
          { cause: error },
        );
      }
      if (matchesUpdate(current, input)) return withoutPath(current);
      throw new WorkspaceApplicationError(
        "workspace-result-unknown",
        "The Workspace Node update result could not be confirmed from current Node metadata.",
        {
          actual: {
            name: current.name,
            parentNodeId: current.parentNodeId,
          },
          cause: error instanceof Error ? error.message : String(error),
          nodeId: input.nodeId,
          requested: patch,
        },
        { cause: error },
      );
    }
  }
}

async function listDirectory(
  http: WorkspaceHttp,
  spaceId: string,
  parentNodeId: string | undefined,
  signal?: AbortSignal,
): Promise<readonly WorkspaceNode[]> {
  const base =
    parentNodeId === undefined
      ? `/api/spaces/${encodeURIComponent(spaceId)}/nodes`
      : `/api/nodes/${encodeURIComponent(parentNodeId)}/children`;
  const nodes: WorkspaceNode[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let metadata: string | undefined;
  do {
    signal?.throwIfAborted();
    const page = parseNodePage(
      await http.json(
        cursor === null ? base : `${base}?cursor=${encodeURIComponent(cursor)}`,
        signal === undefined ? {} : { signal },
      ),
      spaceId,
      parentNodeId,
    );
    const currentMetadata = JSON.stringify({
      breadcrumbs: page.breadcrumbs,
      navigationRootNodeId: page.navigationRootNodeId,
      parentNode: page.parentNode,
      space: page.space,
    });
    if (metadata !== undefined && metadata !== currentMetadata) {
      throw invalidResponse("Workspace Node pagination metadata changed between pages");
    }
    metadata = currentMetadata;
    nodes.push(...page.nodes);
    cursor = page.nextCursor;
    if (cursor !== null && cursors.has(cursor))
      throw invalidResponse("Workspace repeated a Node cursor");
    if (cursor !== null) cursors.add(cursor);
  } while (cursor !== null);
  return nodes;
}

function matches(
  node: WorkspaceNode,
  kind: WorkspaceResourceKindFilter | undefined,
  type: WorkspaceUnitType | undefined,
): boolean {
  if (kind === "none") return node.resource === null && type === undefined;
  if (node.resource === null) return kind === undefined && type === undefined;
  if (kind !== undefined && node.resource.kind !== kind) return false;
  return type === undefined || (node.resource.kind === "univer" && node.resource.unitType === type);
}

function invalidResponse(message: string): Error {
  return workspaceError("workspace-invalid-response", message);
}

function normalizedNodeName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 255) {
    throw workspaceError(
      "workspace-argument-invalid",
      "Node name must contain between 1 and 255 characters after trimming.",
    );
  }
  return name;
}

function assertUpdatedNode(
  node: WorkspaceNodeSummary,
  input:
    | { readonly kind: "rename"; readonly name: string; readonly nodeId: string }
    | { readonly kind: "move"; readonly nodeId: string; readonly parentNodeId: string | null },
): void {
  if (node.nodeId !== input.nodeId || !matchesUpdate(node, input)) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace returned a Node that does not match the requested update.",
      {
        actual: { name: node.name, nodeId: node.nodeId, parentNodeId: node.parentNodeId },
        requested:
          input.kind === "rename" ? { name: input.name } : { parentNodeId: input.parentNodeId },
      },
    );
  }
}

function matchesUpdate(
  node: WorkspaceNodeSummary,
  input:
    | { readonly kind: "rename"; readonly name: string; readonly nodeId: string }
    | { readonly kind: "move"; readonly nodeId: string; readonly parentNodeId: string | null },
): boolean {
  return (
    node.nodeId === input.nodeId &&
    (input.kind === "rename" ? node.name === input.name : node.parentNodeId === input.parentNodeId)
  );
}

function withoutPath(node: WorkspaceNode): WorkspaceNodeSummary {
  const { path: _path, ...summary } = node;
  return summary;
}
