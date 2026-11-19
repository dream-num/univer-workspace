import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver, NodeAccess, ResourceAccess } from "../access/index.js";
import { nodeSummary, resourceSummary } from "../nodes/nodes.service.js";
import type {
  ViewsRepository,
  OwnedRow,
  RecentCursor,
  RecentRow,
  SharedRow,
} from "./views.repository.js";
import type {
  OwnedResourceItem,
  OwnedResourceList,
  RecentResourceItem,
  RecentResourceList,
  SharedItem,
  SharedList,
} from "./views.types.js";

export interface ViewsModule {
  listRecent(
    userId: string,
    page: { readonly cursor: unknown; readonly limit: unknown },
  ): Promise<RecentResourceList>;
  listOwned(
    userId: string,
    page: { readonly cursor: unknown; readonly limit: unknown },
  ): Promise<OwnedResourceList>;
  listHtmlViews(
    userId: string,
    page: { readonly cursor: unknown; readonly limit: unknown; readonly spaceId?: unknown },
  ): Promise<OwnedResourceList>;
  listShared(
    userId: string,
    page: { readonly cursor: unknown; readonly limit: unknown },
  ): Promise<SharedList>;
}

export function createViewsModule(options: {
  readonly repository: ViewsRepository;
  readonly access: AccessResolver;
}): ViewsModule {
  return {
    async listRecent(userId, page) {
      const limit = validLimit(page.limit);
      let scanCursor = decodeCursor(page.cursor);
      const visible: Array<{
        readonly row: RecentRow;
        readonly resource: ResourceAccess;
      }> = [];
      while (visible.length < limit + 1) {
        const rows = await options.repository.listRecent(userId, scanCursor, 100);
        for (const row of rows) {
          const resource = await options.access.resolveResource(userId, row.resource_id);
          if (resource) visible.push({ row, resource });
          scanCursor = recentRowCursor(row);
          if (visible.length === limit + 1) break;
        }
        if (rows.length < 100) break;
      }
      const hasNext = visible.length > limit;
      const items = hasNext ? visible.slice(0, limit) : visible;
      const last = items.at(-1);
      return {
        items: await Promise.all(items.map(({ row, resource }) => recentItem(row, resource, options.repository))),
        nextCursor: hasNext && last ? encodeCursor(recentRowCursor(last.row)) : null,
      };
    },

    async listOwned(userId, page) {
      const limit = validLimit(page.limit);
      let scanCursor = decodeCursor(page.cursor);
      const visible: Array<{
        readonly row: OwnedRow;
        readonly resource: ResourceAccess;
      }> = [];
      while (visible.length < limit + 1) {
        const rows = await options.repository.listOwned(userId, scanCursor, 100);
        const resources = await options.access.resolveOwnedResources(
          userId,
          rows.map((row) => row.resource_id),
        );
        for (const row of rows) {
          const resource = resources.get(row.resource_id);
          if (resource) visible.push({ row, resource });
          scanCursor = ownedRowCursor(row);
          if (visible.length === limit + 1) break;
        }
        if (rows.length < 100) break;
      }
      const hasNext = visible.length > limit;
      const items = hasNext ? visible.slice(0, limit) : visible;
      const last = items.at(-1);
      return {
        items: await Promise.all(items.map(({ resource }) => ownedItem(resource, options.repository))),
        nextCursor: hasNext && last ? encodeCursor(ownedRowCursor(last.row)) : null,
      };
    },

    async listHtmlViews(userId, page) {
      const limit = validLimit(page.limit);
      const spaceId = optionalSpaceId(page.spaceId);
      let scanCursor = decodeCursor(page.cursor);
      const visible: Array<{
        readonly row: OwnedRow;
        readonly resource: ResourceAccess;
      }> = [];
      while (visible.length < limit + 1) {
        const rows = await options.repository.listHtmlViews(userId, scanCursor, 100, spaceId);
        for (const row of rows) {
          const resource = await options.access.resolveResource(userId, row.resource_id);
          if (resource) visible.push({ row, resource });
          scanCursor = ownedRowCursor(row);
          if (visible.length === limit + 1) break;
        }
        if (rows.length < 100) break;
      }
      const hasNext = visible.length > limit;
      const items = hasNext ? visible.slice(0, limit) : visible;
      const last = items.at(-1);
      return {
        items: await Promise.all(items.map(({ resource }) => ownedItem(resource, options.repository))),
        nextCursor: hasNext && last ? encodeCursor(ownedRowCursor(last.row)) : null,
      };
    },

    async listShared(userId, page) {
      const limit = validLimit(page.limit);
      let scanCursor = decodeCursor(page.cursor);
      const visible: Array<{
        readonly row: SharedRow;
        readonly node: NodeAccess;
      }> = [];
      while (visible.length < limit + 1) {
        const rows = await options.repository.listShared(userId, scanCursor, 100);
        for (const row of rows) {
          const node = await options.access.resolveNode(userId, row.node_id);
          if (node) visible.push({ row, node });
          scanCursor = sharedRowCursor(row);
          if (visible.length === limit + 1) break;
        }
        if (rows.length < 100) break;
      }
      const hasNext = visible.length > limit;
      const items = hasNext ? visible.slice(0, limit) : visible;
      const last = items.at(-1);
      return {
        items: items.map(({ row, node }) => sharedItem(row, node)),
        nextCursor: hasNext && last ? encodeCursor(sharedRowCursor(last.row)) : null,
      };
    },
  };
}

async function recentItem(
  row: RecentRow,
  resource: ResourceAccess,
  repository: ViewsRepository,
): Promise<RecentResourceItem> {
  const node = resource.node;
  return {
    lastOpenedAt: new Date(row.last_opened_at).toISOString(),
    node: nodeSummary(node),
    resource: resourceSummary(node)!,
    location: await resourceLocation(resource, repository),
  };
}

async function ownedItem(resource: ResourceAccess, repository: ViewsRepository): Promise<OwnedResourceItem> {
  return {
    node: nodeSummary(resource.node),
    resource: resourceSummary(resource.node)!,
    location: await resourceLocation(resource, repository),
  };
}

async function resourceLocation(
  resource: ResourceAccess,
  repository: ViewsRepository,
): Promise<RecentResourceItem["location"]> {
  const node = resource.node;
  const breadcrumbs =
    node.parentNodeId === null || node.navigationRootNodeId === node.id
      ? []
      : visibleBreadcrumbs(await repository.breadcrumbs(node.parentNodeId), node.navigationRootNodeId);
  return {
    space: {
      id: node.spaceId,
      type: node.spaceType,
      name: node.spaceName,
    },
    breadcrumbs,
  };
}

function sharedItem(row: SharedRow, node: NodeAccess): SharedItem {
  return {
    node: nodeSummary(node),
    sharedBy: {
      id: row.shared_by_id,
      username: row.shared_by_username,
      displayName: row.shared_by_display_name,
      avatarUrl: row.shared_by_avatar_url,
    },
    sharedAt: new Date(row.shared_at).toISOString(),
  };
}

function visibleBreadcrumbs(
  breadcrumbs: readonly { readonly id: string; readonly name: string }[],
  navigationRootNodeId: string | null,
) {
  if (navigationRootNodeId === null) return breadcrumbs;
  const index = breadcrumbs.findIndex((item) => item.id === navigationRootNodeId);
  return index < 0 ? [] : breadcrumbs.slice(index);
}

function validLimit(value: unknown): number {
  if (value === undefined) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw invalidInput("limit must be an integer between 1 and 200.", "limit");
  }
  return limit;
}

function optionalSpaceId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value) {
    throw invalidInput("spaceId must be a non-empty string.", "spaceId");
  }
  return value;
}

function decodeCursor(value: unknown): RecentCursor | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value) {
    throw invalidInput("cursor is invalid.", "cursor");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (!Number.isSafeInteger(parsed.timestamp) || typeof parsed.id !== "string") {
      throw new Error("invalid cursor shape");
    }
    return parsed as unknown as RecentCursor;
  } catch {
    throw invalidInput("cursor is invalid.", "cursor");
  }
}

function encodeCursor(cursor: RecentCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function recentRowCursor(row: RecentRow): RecentCursor {
  return { timestamp: row.last_opened_at, id: row.resource_id };
}

function ownedRowCursor(row: OwnedRow): RecentCursor {
  return { timestamp: row.updated_at, id: row.resource_id };
}

function sharedRowCursor(row: SharedRow): RecentCursor {
  return { timestamp: row.shared_at, id: row.node_id };
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}
