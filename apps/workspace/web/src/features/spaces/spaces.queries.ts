import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const spacesQueryKey = ["spaces"] as const;

export const spacesQueryOptions = queryOptions({
  queryKey: spacesQueryKey,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/spaces");
    if (error) throw apiError(error);
    return data;
  },
});

export function spaceStarQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: ["spaces", spaceId, "star"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/spaces/{spaceId}/star", {
        params: { path: { spaceId } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}
