import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const sharedWithMeQueryKey = ["shared-with-me"] as const;

export const sharedWithMeQueryOptions = queryOptions({
  queryKey: sharedWithMeQueryKey,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/shared-with-me");
    if (error) throw apiError(error);
    return data;
  },
});
