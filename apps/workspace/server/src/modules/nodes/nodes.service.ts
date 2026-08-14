import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type {
  AccessResolver,
  NodeAccess,
  SpaceAccess,
} from "../access/index.js";
import { resourceCapabilities } from "../access/access.service.js";
import {
  NodesRepository,
  type BreadcrumbRow,
  type NodeCursor,
} from "./nodes.repository.js";
import type {
  Breadcrumb,
  NodePage,
  NodeResponse,
  NodeSummary,
  ResourceSummary,
} from "./nodes.types.js";

interface PageRequest {
  readonly cursor: unknown;
  readonly limit: unknown;
}

export interface NodesModule {
  listSpaceRoot(
    userId: string,
    spaceId: string,
    page: PageRequest
  ): NodePage;
  get(userId: string, nodeId: string): NodeResponse;
  listChildren(
    userId: string,
    nodeId: string,
    page: PageRequest
  ): NodePage;
  create(userId: string, input: unknown): NodeSummary;
  update(userId: string, nodeId: string, input: unknown): NodeSummary;
}

export function createNodesModule(options: {
  readonly repository: NodesRepository;
  readonly access: AccessResolver;
  readonly now?: () => number;
}): NodesModule {
  const now = options.now ?? Date.now;

  function listPage(
    userId: string,
    space: SpaceAccess,
    parentNode: NodeAccess | null,
    pageRequest: PageRequest
  ): NodePage {
    const limit = validLimit(pageRequest.limit);
    const cursor = decodeCursor(pageRequest.cursor);
    const rows = options.repository.listChildren(
      space.id,
      parentNode?.id ?? null,
      cursor,
      limit + 1
    );
    const visible = rows
      .map((row) => options.access.resolveNode(userId, row.id))
      .filter((access): access is NodeAccess => access !== null);
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
              options.repository.breadcrumbs(parentNode.id),
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
    listSpaceRoot(userId, spaceId, page) {
      const space = options.access.resolveSpace(userId, spaceId);
      if (!space) throw notFound();
      return listPage(userId, space, null, page);
    },

    get(userId, nodeId) {
      const node = options.access.resolveNode(userId, nodeId);
      if (!node) throw notFound();
      const space =
        options.access.resolveSpace(userId, node.spaceId) ??
        syntheticSpace(node);
      return {
        node: nodeSummary(node),
        space: spaceSummary(space),
        breadcrumbs: visibleBreadcrumbs(
          options.repository.breadcrumbs(node.id),
          node.navigationRootNodeId
        ),
        navigationRootNodeId: node.navigationRootNodeId,
      };
    },

    listChildren(userId, nodeId, page) {
      const node = options.access.resolveNode(userId, nodeId);
      if (!node || !node.capabilities.browseChildren) throw notFound();
      const space =
        options.access.resolveSpace(userId, node.spaceId) ??
        syntheticSpace(node);
      return listPage(userId, space, node, page);
    },

    create(userId, inputValue) {
      const input = validCreate(inputValue);
      validateTarget(
        userId,
        input.spaceId,
        input.parentNodeId,
        options.access
      );
      const id = randomUUID();
      const createdAt = now();
      options.repository.createNode({
        id,
        spaceId: input.spaceId,
        parentNodeId: input.parentNodeId,
        name: input.name,
        createdBy: userId,
        createdAt,
      });
      const access = options.access.resolveNode(userId, id);
      if (!access) throw new Error("Created Node is not discoverable.");
      return nodeSummary(access);
    },

    update(userId, nodeId, inputValue) {
      const patch = validPatch(inputValue);
      const source = options.access.resolveNode(userId, nodeId);
      if (!source) throw notFound();
      if (patch.name !== undefined && !source.capabilities.rename) {
        throw forbidden();
      }
      if (patch.parentNodeId !== undefined) {
        if (!source.capabilities.move) throw forbidden();
        if (
          patch.parentNodeId !== null &&
          options.repository.isSelfOrDescendant(
            source.id,
            patch.parentNodeId
          )
        ) {
          throw new ApplicationError(
            "CONFLICT",
            409,
            "A Node cannot be moved into itself or one of its descendants."
          );
        }
        validateTarget(
          userId,
          source.spaceId,
          patch.parentNodeId,
          options.access
        );
      }
      options.repository.updateNode({
        nodeId,
        name: patch.name ?? source.name,
        parentNodeId:
          patch.parentNodeId === undefined
            ? source.parentNodeId
            : patch.parentNodeId,
        updatedAt: now(),
      });
      const updated = options.access.resolveNode(userId, nodeId);
      if (!updated) throw new Error("Updated Node is not discoverable.");
      return nodeSummary(updated);
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
    access.unitType
  ) {
    return {
      id: access.resourceId,
      kind: "univer",
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

function validateTarget(
  userId: string,
  spaceId: string,
  parentNodeId: string | null,
  access: AccessResolver
): void {
  if (parentNodeId === null) {
    const space = access.resolveSpace(userId, spaceId);
    if (!space) throw notFound();
    if (!space.capabilities.createAtRoot) throw forbidden();
    return;
  }
  const parent = access.resolveNode(userId, parentNodeId);
  if (!parent || parent.spaceId !== spaceId) throw notFound();
  if (!parent.capabilities.createChildren) throw forbidden();
}

function syntheticSpace(node: NodeAccess): SpaceAccess {
  return {
    id: node.spaceId,
    type: node.spaceType,
    name: node.spaceName,
    ownerUserId: "",
    publicRead: false,
    role: node.role,
    capabilities: {
      browseRoot: false,
      createAtRoot: false,
      renameSpace: false,
      manageMembers: false,
      viewTrash: false,
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

function validPatch(value: unknown): {
  readonly name?: string;
  readonly parentNodeId?: string | null;
} {
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

function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "The current user cannot perform this action."
  );
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}
