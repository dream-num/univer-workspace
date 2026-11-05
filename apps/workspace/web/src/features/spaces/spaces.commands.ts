import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { spaceNodesQueryOptions } from "../nodes/nodes.queries";
import { spacesQueryKey, spaceStarQueryOptions, starredSpacesQueryOptions, spacePinsQueryOptions } from "./spaces.queries";

export function useUpdateSpace(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      readonly name?: string;
      readonly slug?: string;
      readonly publicRead?: boolean;
      readonly description?: string;
    }) => {
      const { error } = await api.PATCH("/api/spaces/{spaceId}", {
        params: { path: { spaceId } },
        body: values,
      });
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: spacesQueryKey }),
        client.invalidateQueries({ queryKey: spaceNodesQueryOptions(spaceId).queryKey }),
      ]);
    },
  });
}

export function useCreateTeamSpace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      readonly name: string;
      readonly slug?: string;
      readonly publicRead: boolean;
    }) => {
      const { data, error } = await api.POST("/api/team-spaces", { body: values });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: spacesQueryKey });
    },
  });
}

export function useToggleSpaceStar(spaceId: string) {
  const client = useQueryClient();
  const options = spaceStarQueryOptions(spaceId);
  return useMutation({
    mutationFn: async (starred: boolean) => {
      const request = { params: { path: { spaceId } } };
      const { data, error } = starred
        ? await api.PUT("/api/spaces/{spaceId}/star", request)
        : await api.DELETE("/api/spaces/{spaceId}/star", request);
      if (error) throw apiError(error);
      return data;
    },
    onMutate: async (starred) => {
      await client.cancelQueries({ queryKey: options.queryKey });
      const previous = client.getQueryData(options.queryKey);
      if (previous)
        client.setQueryData(options.queryKey, {
          starred,
          starCount: previous.starCount + (starred ? 1 : -1),
        });
      return previous;
    },
    onSuccess: (data) => client.setQueryData(options.queryKey, data),
    onError: (_error, _starred, previous) => {
      if (previous) client.setQueryData(options.queryKey, previous);
    },
    // Reconcile ambiguous network failures as well as successful writes.
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey: options.queryKey }),
      client.invalidateQueries({ queryKey: starredSpacesQueryOptions.queryKey }),
      client.invalidateQueries({ queryKey: spacePinsQueryOptions.queryKey }),
    ]),
  });
}

export function useSetSpacePins() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (spaceIds: string[]) => {
      const { data, error } = await api.PUT("/api/spaces/pins", { body: { spaceIds } });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: (pins) => client.setQueryData(spacePinsQueryOptions.queryKey, pins),
    onError: () => client.invalidateQueries({ queryKey: spacesQueryKey }),
  });
}

export function useResetSpacePins() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.DELETE("/api/spaces/pins");
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: (pins) => client.setQueryData(spacePinsQueryOptions.queryKey, pins),
  });
}
