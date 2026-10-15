import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { nodeGrantsQueryOptions, nodeLinkSharingQueryOptions, teamMembersQueryOptions } from "./permissions.queries";

type NodeGrant = { readonly nodeId: string; readonly userId: string };
type Member = { readonly spaceId: string; readonly userId: string };

export function useSetNodeGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ nodeId, userId, role }: NodeGrant & { readonly role: "editor" | "viewer" }) => {
      const { data, error } = await api.PUT("/api/nodes/{nodeId}/grants/{userId}", {
        params: { path: { nodeId, userId } },
        body: { role },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: (_, { nodeId }) => client.invalidateQueries({ queryKey: nodeGrantsQueryOptions(nodeId).queryKey }),
  });
}

export function useRemoveNodeGrant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ nodeId, userId }: NodeGrant) => {
      const { error } = await api.DELETE("/api/nodes/{nodeId}/grants/{userId}", {
        params: { path: { nodeId, userId } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: (_, { nodeId }) => client.invalidateQueries({ queryKey: nodeGrantsQueryOptions(nodeId).queryKey }),
  });
}

export function useSetLinkSharing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      nodeId,
      enabled,
      role,
    }: {
      readonly nodeId: string;
      readonly enabled: boolean;
      readonly role: "editor" | "viewer";
    }) => {
      const { data, error } = await api.PUT("/api/nodes/{nodeId}/link-sharing", {
        params: { path: { nodeId } },
        body: { enabled, role },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: (_, { nodeId }) => client.invalidateQueries({ queryKey: nodeLinkSharingQueryOptions(nodeId).queryKey }),
  });
}

export function useSetMemberRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ spaceId, userId, role }: Member & { readonly role: "admin" | "editor" | "viewer" }) => {
      const { error } = await api.PUT("/api/team-spaces/{spaceId}/members/{userId}", {
        params: { path: { spaceId, userId } },
        body: { role },
      });
      if (error) throw apiError(error);
    },
    onSuccess: (_, { spaceId }) => client.invalidateQueries({ queryKey: teamMembersQueryOptions(spaceId).queryKey }),
  });
}

export function useRemoveMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ spaceId, userId }: Member) => {
      const { error } = await api.DELETE("/api/team-spaces/{spaceId}/members/{userId}", {
        params: { path: { spaceId, userId } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: (_, { spaceId }) => client.invalidateQueries({ queryKey: teamMembersQueryOptions(spaceId).queryKey }),
  });
}
