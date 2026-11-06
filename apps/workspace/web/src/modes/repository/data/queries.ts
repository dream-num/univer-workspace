import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/client";
import { apiError } from "../../../shared/api/errors";
import { recentResourceSummaryQueryOptions } from "../../../features/views/recent.queries";
import type { NodeAncestry } from "./pending";
import type { Issue, Page, Space, WindowPage, Worktree } from "./types";

const MAX_WINDOW_PAGES = 5;

async function scanWindow<T extends { readonly updatedAt: string }>(
  startIso: string,
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<WindowPage<T>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_WINDOW_PAGES; page += 1) {
    const data = await fetchPage(cursor);
    items.push(...data.items);
    const tail = data.items.at(-1);
    if (!data.nextCursor || (tail && Date.parse(tail.updatedAt) < Date.parse(startIso))) {
      return { items, complete: true };
    }
    cursor = data.nextCursor;
  }
  // shortcut: five pages per activity source, replace with server activity buckets in PR2.
  return { items, complete: false };
}

function spaceFilter(space: Space) {
  return space.type === "team" ? { teamSpaceId: space.id } : { kind: "user" as const };
}

export function worktreeWindowQueryOptions(space: Space, startIso: string) {
  return queryOptions({
    queryKey: ["worktrees", "repository", space.id, space.type, "window", startIso],
    queryFn: ({ signal }) => scanWindow<Worktree>(startIso, async (cursor) => {
      const { data, error } = await api.GET("/api/worktrees", {
        signal,
        params: { query: { ...spaceFilter(space), scope: "all", order: "updatedAtDesc", limit: 100, ...(cursor ? { cursor } : {}) } },
      });
      if (error) throw apiError(error);
      return data;
    }),
  });
}

export function issueWindowQueryOptions(space: Space, startIso: string) {
  return queryOptions({
    queryKey: ["issues", "repository", space.id, space.type, "window", startIso],
    queryFn: ({ signal }): Promise<WindowPage<Issue>> => space.type === "personal"
      ? Promise.resolve({ items: [], complete: true })
      : scanWindow<Issue>(startIso, async (cursor) => {
        const { data, error } = await api.GET("/api/spaces/{spaceId}/issues", {
          signal,
          params: { path: { spaceId: space.id }, query: { state: "all", sort: "updated", order: "desc", limit: 200, ...(cursor ? { cursor } : {}) } },
        });
        if (error) throw apiError(error);
        return data;
      }),
  });
}

export function openWorktreesQueryOptions(space: Space) {
  return queryOptions({
    queryKey: ["worktrees", "repository", space.id, space.type, "open"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/worktrees", {
        signal,
        params: { query: { ...spaceFilter(space), scope: "active", state: ["draft", "ready", "merging"], order: "updatedAtDesc", limit: 100 } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function ancestryQueryOptions(nodeId: string) {
  return queryOptions({
    queryKey: ["worktrees", "repository", "ancestry", nodeId],
    queryFn: async ({ signal }): Promise<{ nodeId: string; ancestry: NodeAncestry | null }> => {
      const { data, error, response } = await api.GET("/api/nodes/{nodeId}", { signal, params: { path: { nodeId } } });
      // A deleted or inaccessible Node has no visible ancestry. Keep other badges available.
      if (response.status === 404) return { nodeId, ancestry: null };
      if (error) throw apiError(error);
      return {
        nodeId,
        ancestry: {
          spaceId: data.space.id,
          ancestors: data.breadcrumbs.filter((item) => item.id !== nodeId).map((item) => item.id),
          complete: data.navigationRootNodeId === null,
        },
      };
    },
  });
}

export function openIssueFacetsQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: ["issues", "repository", spaceId, "open-facets"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/spaces/{spaceId}/issues", {
        signal,
        params: { path: { spaceId }, query: { state: "open", sort: "updated", order: "desc", limit: 200 } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

export const homeWorktreesQueryOptions = queryOptions({
  queryKey: ["worktrees", "repository", "home", "open"],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/worktrees", {
      signal,
      params: { query: { scope: "active", limit: 100, order: "updatedAtDesc" } },
    });
    if (error) throw apiError(error);
    return data;
  },
});

export const homeIssuesQueryOptions = queryOptions({
  queryKey: ["issues", "repository", "home", "open"],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/issues", {
      signal,
      params: { query: { state: "open", sort: "updated", order: "desc", limit: 100 } },
    });
    if (error) throw apiError(error);
    return data;
  },
});

export const homeQueries = [recentResourceSummaryQueryOptions, homeWorktreesQueryOptions, homeIssuesQueryOptions] as const;
