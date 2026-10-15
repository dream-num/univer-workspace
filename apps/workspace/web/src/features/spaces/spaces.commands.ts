import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { spaceNodesQueryOptions } from "../nodes/nodes.queries";
import { spacesQueryKey, spaceStarQueryOptions } from "./spaces.queries";

export function useUpdateSpace(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      readonly name?: string;
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
    mutationFn: async (values: { readonly name: string; readonly publicRead: boolean }) => {
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
    onSettled: () => client.invalidateQueries({ queryKey: options.queryKey }),
  });
}
