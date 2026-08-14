import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export function nodeGrantsQueryOptions(nodeId: string) {
  return queryOptions({
    queryKey: ["node-grants", nodeId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/nodes/{nodeId}/grants",
        { params: { path: { nodeId } } }
      );
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function nodeLinkSharingQueryOptions(nodeId: string) {
  return queryOptions({
    queryKey: ["node-link-sharing", nodeId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/nodes/{nodeId}/link-sharing",
        { params: { path: { nodeId } } }
      );
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function teamMembersQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: ["team-members", spaceId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/team-spaces/{spaceId}/members",
        { params: { path: { spaceId } } }
      );
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function userSearchQueryOptions(query: string) {
  return queryOptions({
    queryKey: ["user-search", query] as const,
    enabled: query.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/users/search", {
        params: { query: { query: query.trim() } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}
