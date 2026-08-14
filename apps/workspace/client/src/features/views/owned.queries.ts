import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const ownedByMeQueryKey = ["owned-by-me"] as const;

export const ownedByMeQueryOptions = queryOptions({
  queryKey: ownedByMeQueryKey,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/owned-by-me", {
      params: { query: {} },
    });
    if (error) throw apiError(error);
    return data;
  },
});
