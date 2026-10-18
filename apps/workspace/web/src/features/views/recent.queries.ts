import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const recentResourcesQueryKey = ["recent-resources"] as const;

export const recentResourceSummaryQueryOptions = queryOptions({
  queryKey: [...recentResourcesQueryKey, "summary"] as const,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/recent-resources", {
      params: { query: { limit: 12 } },
    });
    if (error) throw apiError(error);
    return data;
  },
});

export const recentResourcePagesQueryOptions = infiniteQueryOptions({
  queryKey: [...recentResourcesQueryKey, "pages"] as const,
  initialPageParam: undefined as string | undefined,
  queryFn: async ({ pageParam }) => {
    const { data, error } = await api.GET("/api/recent-resources", {
      params: { query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
    });
    if (error) throw apiError(error);
    return data;
  },
  getNextPageParam: (page) => page.nextCursor ?? undefined,
});

export const recentResourcesQueryOptions = queryOptions({
  queryKey: recentResourcesQueryKey,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/recent-resources", {
      params: { query: {} },
    });
    if (error) throw apiError(error);
    return data;
  },
});
