import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const recentResourcesQueryKey = ["recent-resources"] as const;

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
