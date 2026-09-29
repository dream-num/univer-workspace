import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const issuesQueryKey = ["issues"] as const;

export interface IssueFilters {
  readonly state: "open" | "closed" | "all";
  readonly labels: readonly string[];
  /** A User ID, `me` or `none`. */
  readonly assignee?: string | undefined;
  /** A User ID or `me`. */
  readonly author?: string | undefined;
  readonly q?: string | undefined;
  readonly sort: "created" | "updated";
  readonly order: "asc" | "desc";
}

export const DEFAULT_ISSUE_FILTERS: IssueFilters = {
  state: "open",
  labels: [],
  sort: "created",
  order: "desc",
};

function filterQuery(filters: IssueFilters) {
  return {
    state: filters.state,
    ...(filters.labels.length ? { label: [...filters.labels] } : {}),
    ...(filters.assignee ? { assignee: filters.assignee } : {}),
    ...(filters.author ? { author: filters.author } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    sort: filters.sort,
    order: filters.order,
  };
}

/** One Space's Issues, or every Team Space the caller belongs to when `spaceId` is undefined. */
export function issueListQueryOptions(spaceId: string | undefined, filters: IssueFilters) {
  return infiniteQueryOptions({
    queryKey: [...issuesQueryKey, "list", spaceId ?? "mine", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const query = { ...filterQuery(filters), ...(pageParam ? { cursor: pageParam } : {}) };
      const { data, error } = spaceId
        ? await api.GET("/api/spaces/{spaceId}/issues", { params: { path: { spaceId }, query } })
        : await api.GET("/api/issues", { params: { query } });
      if (error) throw apiError(error);
      return data;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** One-row request used only for the open count badge on the repository tab. */
export function issueCountsQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: [...issuesQueryKey, "counts", spaceId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/spaces/{spaceId}/issues", {
        params: { path: { spaceId }, query: { limit: 1 } },
      });
      if (error) throw apiError(error);
      return data.counts;
    },
  });
}

/** The first page of open Issues shown under a Space in the Wiki sidebar. */
export function sidebarIssuesQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: [...issuesQueryKey, "sidebar", spaceId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/spaces/{spaceId}/issues", {
        params: { path: { spaceId }, query: { limit: 20 } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function issueQueryOptions(spaceId: string, number: number) {
  return queryOptions({
    queryKey: [...issuesQueryKey, "detail", spaceId, number] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/spaces/{spaceId}/issues/{number}", {
        params: { path: { spaceId, number } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

const MAX_TIMELINE_PAGES = 25;

export function issueTimelineQueryOptions(spaceId: string, number: number) {
  return queryOptions({
    queryKey: [...issuesQueryKey, "timeline", spaceId, number] as const,
    queryFn: async () => {
      const items = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_TIMELINE_PAGES; page += 1) {
        const { data, error } = await api.GET("/api/spaces/{spaceId}/issues/{number}/timeline", {
          params: { path: { spaceId, number }, query: { limit: 200, ...(cursor ? { cursor } : {}) } },
        });
        if (error) throw apiError(error);
        items.push(...data.items);
        if (!data.nextCursor) break;
        cursor = data.nextCursor;
      }
      return items;
    },
  });
}

export function issueLabelsQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: [...issuesQueryKey, "labels", spaceId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/spaces/{spaceId}/issue-labels", {
        params: { path: { spaceId } },
      });
      if (error) throw apiError(error);
      return data.labels;
    },
  });
}
