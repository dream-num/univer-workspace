import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/client";
import { apiError } from "../../../shared/api/errors";
import { recentResourceSummaryQueryOptions } from "../../../features/views/recent.queries";
import type { NodeAncestry } from "./pending";
import { activityQueryKey } from "../../../features/worktrees/worktrees.queries";
import { parseRepositoryActivity } from "./activity";
import type { Space } from "./types";

function spaceFilter(space: Space) {
  return space.type === "team" ? { teamSpaceId: space.id } : { kind: "user" as const };
}

export function repositoryActivityQueryOptions(spaceId: string, timeZone: string) {
  return queryOptions({
    queryKey: [...activityQueryKey, spaceId, timeZone],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/spaces/{spaceId}/activity", {
        signal,
        params: { path: { spaceId }, query: { timeZone } },
      });
      if (error) throw apiError(error);
      return parseRepositoryActivity(data);
    },
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
