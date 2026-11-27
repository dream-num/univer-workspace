import { randomUUID } from "node:crypto";
import { logger } from "../../logging/logger.js";
import { ApplicationError } from "../../middleware/errors.js";
import type {
  AccessResolver,
  NodeAccess,
  SpaceAccess,
} from "../access/index.js";
import { resourceCapabilities } from "../access/access.service.js";
import { createSourceRateLimiter, isUserlessReader, type Principal, type SourceRateStore } from "../identity/index.js";
import { nodeNotFound as notFound } from "./nodes.errors.js";
import type {
  NodesRepository,
  BreadcrumbRow,
  NodeCursor,
  NodePatch,
  SpaceOwnerRow,
} from "./nodes.repository.js";
import type {
  Breadcrumb,
  NodeOwner,
  NodePage,
  NodeResponse,
  NodeSummary,
  ResourceSummary,
} from "./nodes.types.js";

const MAX_REPORT_REASON_LENGTH = 1000;
const REPORT_LIMIT_PER_HOUR = 10;

interface PageRequest {
  readonly cursor: unknown;
  readonly limit: unknown;
}

export interface NodesModule {
  listSpaceRoot(
    userId: string,
    spaceId: string,
    page: PageRequest
  ): Promise<NodePage>;
  get(userId: string, nodeId: string): Promise<NodeResponse>;
  listChildren(
    userId: string,
    nodeId: string,
    page: PageRequest
  ): Promise<NodePage>;
  create(userId: string, input: unknown): Promise<NodeSummary>;
  update(actor: Principal, nodeId: string, input: unknown): Promise<NodeSummary>;
  /**
   * Files an abuse report on a Node the requester can read; anyone may, signed in or not. The
   * source IP is only the rate-limit key and is never stored with the report.
   */
  report(
    userId: string,
    nodeId: string,
    input: unknown,
    originIp: string | undefined
  ): Promise<{ readonly id: string }>;
}

export function createNodesModule(options: {
  readonly repository: NodesRepository;
  readonly access: AccessResolver;
  readonly sourceRates: SourceRateStore;
  readonly now?: () => number;
}): NodesModule {
  const now = options.now ?? Date.now;
  const reportLimiter = createSourceRateLimiter(options.sourceRates, "node_report", REPORT_LIMIT_PER_HOUR, now);

  async function listPage(
    userId: string,
    space: SpaceAccess,
    parentNode: NodeAccess | null,
    pageRequest: PageRequest
  ): Promise<NodePage> {
    const limit = validLimit(pageRequest.limit);
    const cursor = decodeCursor(pageRequest.cursor);
    const rows = await options.repository.listChildren(
      space.id,
      parentNode?.id ?? null,
      cursor,
      limit + 1
    );
    const resolved = await Promise.all(rows.map((row) => options.access.resolveNode(userId, row.id)));
    const visible = resolved.filter((node): node is NodeAccess => node !== null);
    const hasNext = visible.length > limit;
    const page = hasNext ? visible.slice(0, limit) : visible;
    const last = page.at(-1);
    return {
      space: spaceSummary(space),
      parentNode: parentNode ? nodeSummary(parentNode) : null,
      navigationRootNodeId:
        parentNode?.navigationRootNodeId ?? null,
      breadcrumbs:
        parentNode === null
          ? []
          : visibleBreadcrumbs(
              await options.repository.breadcrumbs(parentNode.id),
              parentNode.navigationRootNodeId
            ),
      nodes: page.map(nodeSummary),
      nextCursor:
        hasNext && last
          ? encodeCursor({ name: last.name, id: last.id })
          : null,
    };
  }

  return {
    async listSpaceRoot(userId, spaceId, page) {
      const space = await options.access.resolveSpace(userId, spaceId);
      if (!space) throw notFound();
      return listPage(userId, space, null, page);
    },

    async get(userId, nodeId) {
      const node = await options.access.resolveNode(userId, nodeId);
      if (!node) throw notFound();
      const space =
        await options.access.resolveSpace(userId, node.spaceId) ??
        syntheticSpace(node);
      const { copiedFromNodeId, copyCount } = await options.repository.copies(node.id);
      const owner = await options.repository.findSpaceOwner(node.spaceId);
      return {
        node: nodeSummary(node),
        space: spaceSummary(space),
        // Anyone with the link reads an unclaimed agent's Team Space file, and must see who made it.
        owner: node.spaceType === "personal" || (owner.kind === "agent" && owner.claimed !== 1)
          ? nodeOwner(owner)
          : null,
        breadcrumbs: visibleBreadcrumbs(
          await options.repository.breadcrumbs(node.id),
          node.navigationRootNodeId
        ),
        navigationRootNodeId: node.navigationRootNodeId,
        // A link-shared source's Node ID is its access link, so only those who can edit the copy learn it.
        copiedFromNodeId: node.role === "viewer" ? null : copiedFromNodeId,
        copyCount,
      };
    },

    async listChildren(userId, nodeId, page) {
      const node = await options.access.resolveNode(userId, nodeId);
      if (!node || !node.capabilities.browseChildren) throw notFound();
      const space =
        await options.access.resolveSpace(userId, node.spaceId) ??
        syntheticSpace(node);
      return listPage(userId, space, node, page);
    },

    async create(userId, inputValue) {
      const input = validCreate(inputValue);
      await options.access.assertChangesTrunk(userId, input.spaceId);
      const node = await options.repository.createNode({
        ...input,
        id: randomUUID(),
        createdBy: userId,
        createdAt: now(),
      });
      return nodeSummary(node);
    },

    async update(actor, nodeId, inputValue) {
      const patch = validPatch(inputValue);
      const source = await options.access.resolveNode(actor.user.id, nodeId);
      if (source) await options.access.assertChangesTrunk(actor.user.id, source.spaceId);
      const node = await options.repository.updateNode(actor, nodeId, patch, now());
      return nodeSummary(node);
    },

    async report(userId, nodeId, inputValue, originIp) {
      // A Node the requester cannot read is indistinguishable from a missing one, as on the Node route.
      if (!(await options.access.resolveNode(userId, nodeId))) throw notFound();
      const reason = validReportReason(inputValue);
      if (!(await reportLimiter.take(originIp))) {
        throw new ApplicationError(
          "REPORT_RATE_LIMITED",
          429,
          "Too many reports were sent from this address. Try again later."
        );
      }
      const id = randomUUID();
      await options.repository.createReport({
        id,
        nodeId,
        reporterUserId: isUserlessReader(userId) ? null : userId,
        reason,
        createdAt: now(),
      });
      // The reason is free text from an untrusted reader, so it stays out of the log.
      logger.warn({ event: "node_reported", nodeId, reportId: id }, "node reported");
      return { id };
    },
  };
}

export function nodeSummary(access: NodeAccess): NodeSummary {
  return {
    id: access.id,
    spaceId: access.spaceId,
    parentNodeId: access.parentNodeId,
    name: access.name,
    resource: resourceSummary(access),
    hasChildren: access.hasChildren,
    updatedAt: new Date(access.updatedAt).toISOString(),
    accessRole: access.role,
    capabilities: access.capabilities,
  };
}

export function resourceSummary(access: NodeAccess): ResourceSummary | null {
  if (
    access.resourceId &&
    access.resourceKind === "univer" &&
    access.unitId &&
    access.unitType
  ) {
    return {
      id: access.resourceId,
      kind: "univer",
      unitId: access.unitId,
      unitType: access.unitType,
      capabilities: resourceCapabilities(access.role, "univer"),
    };
  }
  if (
    access.resourceId &&
    access.resourceKind === "blob" &&
    access.blobMediaType &&
    access.blobByteSize !== null &&
    access.blobAvailability
  ) {
    return {
      id: access.resourceId,
      kind: "blob",
      mediaType: access.blobMediaType,
      byteSize: access.blobByteSize,
      availability: access.blobAvailability,
      capabilities: resourceCapabilities(access.role, "blob"),
    };
  }
  return null;
}

function nodeOwner(row: SpaceOwnerRow): NodeOwner {
  return row.kind === "agent"
    ? { displayName: row.display_name, kind: "agent", claimed: row.claimed === 1 }
    : { displayName: row.display_name, kind: "human" };
}

function syntheticSpace(node: NodeAccess): SpaceAccess {
  return {
    id: node.spaceId,
    type: node.spaceType,
    name: node.spaceName,
    ownerUserId: "",
    publicRead: false,
    landing: "review",
    member: false,
    role: node.role,
    capabilities: {
      browseRoot: false,
      createAtRoot: false,
      renameSpace: false,
      manageMembers: false,
      viewTrash: false,
      createIssue: false,
      triageIssues: false,
      manageIssueLabels: false,
      propose: false,
    },
  };
}

function spaceSummary(space: SpaceAccess): {
  readonly id: string;
  readonly type: SpaceAccess["type"];
  readonly name: string;
} {
  return { id: space.id, type: space.type, name: space.name };
}

function visibleBreadcrumbs(
  breadcrumbs: readonly BreadcrumbRow[],
  navigationRootNodeId: string | null
): readonly Breadcrumb[] {
  if (navigationRootNodeId === null) return breadcrumbs;
  const index = breadcrumbs.findIndex(
    (item) => item.id === navigationRootNodeId
  );
  return index < 0 ? [] : breadcrumbs.slice(index);
}

function validCreate(value: unknown): {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
} {
  const record = requiredRecord(value);
  return {
    spaceId: requiredId(record.spaceId, "spaceId"),
    parentNodeId: nullableId(record.parentNodeId, "parentNodeId"),
    name: validName(record.name),
  };
}

function validPatch(value: unknown): NodePatch {
  const record = requiredRecord(value);
  const hasName = Object.hasOwn(record, "name");
  const hasParentNodeId = Object.hasOwn(record, "parentNodeId");
  if (!hasName && !hasParentNodeId) {
    throw invalidInput("At least one Node field is required.");
  }
  return {
    ...(hasName ? { name: validName(record.name) } : {}),
    ...(hasParentNodeId
      ? {
          parentNodeId: nullableId(
            record.parentNodeId,
            "parentNodeId"
          ),
        }
      : {}),
  };
}

function validReportReason(value: unknown): string {
  const reason = requiredRecord(value).reason;
  if (
    typeof reason !== "string" ||
    reason.trim().length === 0 ||
    reason.length > MAX_REPORT_REASON_LENGTH
  ) {
    throw invalidInput(
      `reason must be a non-empty string of at most ${MAX_REPORT_REASON_LENGTH} characters.`,
      "reason"
    );
  }
  return reason.trim();
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInput("A Node definition is required.");
  }
  return value as Record<string, unknown>;
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidInput(`${field} is required.`, field);
  }
  return value;
}

function nullableId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredId(value, field);
}

function validName(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Node name is required.", "name");
  }
  const name = value.trim();
  if (!name || name.length > 255) {
    throw invalidInput(
      "Node name must contain between 1 and 255 characters.",
      "name"
    );
  }
  return name;
}

function validLimit(value: unknown): number {
  if (value === undefined) return 100;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw invalidInput("limit must be an integer between 1 and 200.", "limit");
  }
  return limit;
}

function decodeCursor(value: unknown): NodeCursor | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value) {
    throw invalidInput("cursor is invalid.", "cursor");
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    if (
      typeof parsed.name !== "string" ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("invalid cursor shape");
    }
    return { name: parsed.name, id: parsed.id };
  } catch {
    throw invalidInput("cursor is invalid.", "cursor");
  }
}

function encodeCursor(cursor: NodeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}
