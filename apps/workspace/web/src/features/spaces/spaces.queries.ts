import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { api } from "../../shared/api/client";
import { ApiError, apiError } from "../../shared/api/errors";

export const spacesQueryKey = ["spaces"] as const;

export const mySpacesQueryOptions = queryOptions({
  queryKey: [...spacesQueryKey, "list", "mine"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/spaces");
    if (error) throw apiError(error);
    return data;
  },
});

export const starredSpacesQueryOptions = queryOptions({
  queryKey: [...spacesQueryKey, "list", "starred"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/spaces/starred");
    if (error) throw apiError(error);
    return data;
  },
});

export const exploreSpacesQueryOptions = queryOptions({
  queryKey: [...spacesQueryKey, "list", "explore"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/spaces/explore");
    if (error) throw apiError(error);
    return data;
  },
});

export const spacePinsQueryOptions = queryOptions({
  queryKey: [...spacesQueryKey, "pins"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/spaces/pins");
    if (error) throw apiError(error);
    return data;
  },
});

export function spaceQueryOptions(spaceId: string | undefined) {
  return queryOptions({
    queryKey: [...spacesQueryKey, "detail", spaceId],
    enabled: spaceId !== undefined,
    queryFn: async () => {
      if (spaceId === undefined) throw new Error("Space ID is required");
      const { data, error, response } = await api.GET("/api/spaces/{spaceId}", {
        params: { path: { spaceId } },
      });
      if (response.status === 404) throw new ApiError("Space unavailable", "NOT_FOUND");
      if (error) throw apiError(error);
      return data;
    },
  });
}

export async function ensureSpace(queryClient: QueryClient, spaceId: string) {
  try {
    return await queryClient.ensureQueryData(spaceQueryOptions(spaceId));
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") throw notFound();
    throw error;
  }
}

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
