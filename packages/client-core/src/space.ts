import {
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  workspaceError,
} from "./errors.js";
import { isWorkspaceRecord } from "./http.js";
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

  public async list(): Promise<readonly WorkspaceSpace[]> {
    const body = await (await this.authenticatedHttp()).json("/api/spaces");
    if (!Array.isArray(body["spaces"]))
      throw invalidResponse("Workspace response is missing Spaces");
    return body["spaces"].map(parseSpace);
  }

  public async get(spaceId: string): Promise<WorkspaceSpace> {
    const body = await (await this.authenticatedHttp()).json(`/api/spaces/${encodeURIComponent(spaceId)}`);
    return parseSpace(body);
  }

  /** Resolves `<owner>/<slug>`; `slug` `personal` addresses the owner's Personal Space. */
  public async lookup(owner: string, slug: string): Promise<WorkspaceSpace> {
    const http = await this.authenticatedHttp();
    const query = new URLSearchParams({ owner, slug });
    try {
      return parseSpace(await http.json(`/api/spaces/lookup?${query.toString()}`));
    } catch (error) {
      return await rethrowUnlessServerOutdated(http, error);
    }
  }

  /** Creates a Team Space. Without `slug` the server derives one from the name. */
  public async create(input: {
    readonly name: string;
    readonly publicRead?: boolean;
    readonly slug?: string;
  }): Promise<WorkspaceSpace> {
    return parseSpace(
      await (await this.authenticatedHttp()).json("/api/team-spaces", { body: input, method: "POST" }),
    );
  }

  public async update(
    spaceId: string,
    input: {
      readonly description?: string;
      readonly name?: string;
      readonly publicRead?: boolean;
      readonly slug?: string;
    },
  ): Promise<WorkspaceSpace> {
    return parseSpace(
      await (await this.authenticatedHttp()).json(`/api/spaces/${encodeURIComponent(spaceId)}`, {
        body: input,
        method: "PATCH",
      }),
    );
  }

  public async getStar(spaceId: string): Promise<{ readonly starCount: number; readonly starred: boolean }> {
    const body = await (await this.authenticatedHttp()).json(
      `/api/spaces/${encodeURIComponent(spaceId)}/star`,
    );
    if (typeof body["starred"] !== "boolean" || !Number.isSafeInteger(body["starCount"])) {
      throw invalidResponse("Workspace response contains an invalid Space star");
    }
    return { starCount: body["starCount"] as number, starred: body["starred"] };
  }

  public async browse(input: BrowseSpaceInput): Promise<readonly WorkspaceNode[]> {
    const http = await this.authenticatedHttp();
    const visited = new Set<string>(input.parentNodeId === undefined ? [] : [input.parentNodeId]);
    const visit = async (parentNodeId: string | undefined): Promise<readonly WorkspaceNode[]> => {
      const nodes = await listDirectory(http, input.spaceId, parentNodeId);
      const discovered: WorkspaceNode[] = [];
      for (const node of nodes) {
        if (visited.has(node.nodeId)) {
          throw invalidResponse("Workspace Node directory contains a repeated or cyclic Node.");
        }
        visited.add(node.nodeId);
        if (matches(node, input.resourceKind, input.unitType)) discovered.push(node);
        if (input.recursive === true && node.hasChildren) {
          discovered.push(...(await visit(node.nodeId)));
        }
      }
      return discovered;
    };
    return await visit(input.parentNodeId);
  }

  public async find(
    input: Omit<BrowseSpaceInput, "recursive"> & { readonly query: string },
  ): Promise<readonly WorkspaceNode[]> {
    const query = input.query.trim().toLowerCase();
    if (query === "")
      throw workspaceError("workspace-argument-invalid", "Space find query is required.");
    return (await this.browse({ ...input, recursive: true })).filter((node) =>
      node.name.toLowerCase().includes(query),
    );
  }

  public async createNode(input: {
    readonly name: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
  }): Promise<WorkspaceNodeSummary> {
    const name = normalizedNodeName(input.name);
    let body: Record<string, unknown>;
    try {
      body = await (
        await this.authenticatedHttp()
      ).json("/api/nodes", {
        body: { name, parentNodeId: input.parentNodeId ?? null, spaceId: input.spaceId },
        method: "POST",
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
  }): Promise<WorkspaceNodeSummary> {
    const name = normalizedNodeName(input.name);
    return await this.updateNode({ kind: "rename", name, nodeId: input.nodeId });
  }

  public async moveNode(input: {
    readonly nodeId: string;
    readonly parentNodeId: string | null;
  }): Promise<WorkspaceNodeSummary> {
    return await this.updateNode({
      kind: "move",
      nodeId: input.nodeId,
      parentNodeId: input.parentNodeId,
    });
  }

  public async trashNode(nodeId: string): Promise<WorkspaceTrashBatch> {
    let body: Record<string, unknown>;
    try {
      body = await (
        await this.authenticatedHttp()
      ).json(`/api/nodes/${encodeURIComponent(nodeId)}/trash`, { method: "POST" });
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
  ): Promise<WorkspaceNodeSummary> {
    const http = await this.authenticatedHttp();
    const patch =
      input.kind === "rename" ? { name: input.name } : { parentNodeId: input.parentNodeId };
    try {
      const updated = parseDetachedNode(
        await http.json(`/api/nodes/${encodeURIComponent(input.nodeId)}`, {
          body: patch,
          method: "PATCH",
        }),
      );
      assertUpdatedNode(updated, input);
      return updated;
    } catch (error) {
      if (!isWorkspaceResultUnknown(error)) throw error;
      let current: WorkspaceNode;
      try {
        current = parseNodeResponse(
          await http.json(`/api/nodes/${encodeURIComponent(input.nodeId)}`),
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

/**
 * An unknown path and a hidden product object both answer `404 NOT_FOUND` with the same body, so a
 * 404 on a V12-only request is ambiguous. A server that supports repository addressing always
 * includes `fullName` in Space views; when `GET /api/spaces` shows Spaces without it, the 404 means
 * the server predates the endpoint.
 */
export async function rethrowUnlessServerOutdated(http: WorkspaceHttp, error: unknown): Promise<never> {
  if (!(error instanceof WorkspaceApplicationError) || (error.detail as { status?: unknown } | undefined)?.status !== 404) {
    throw error;
  }
  let first: unknown;
  try {
    const body = await http.json("/api/spaces");
    first = Array.isArray(body["spaces"]) ? body["spaces"][0] : undefined;
  } catch (probeError) {
    if (probeError instanceof WorkspaceApplicationError && probeError.code === "workspace-authentication-required") {
      throw probeError;
    }
    throw error;
  }
  if (isWorkspaceRecord(first) && !("fullName" in first)) {
    throw workspaceError(
      "workspace-server-capability-missing",
      "This Workspace server does not support owner/slug or numbered addressing yet; upgrade the server, or address by ID.",
    );
  }
  throw error;
}

async function listDirectory(
  http: WorkspaceHttp,
  spaceId: string,
  parentNodeId: string | undefined,
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
    const page = parseNodePage(
      await http.json(cursor === null ? base : `${base}?cursor=${encodeURIComponent(cursor)}`),
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
