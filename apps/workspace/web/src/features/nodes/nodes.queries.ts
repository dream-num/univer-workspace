import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export function spaceNodesQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: ["nodes", "space", spaceId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/spaces/{spaceId}/nodes",
        {
          params: { path: { spaceId } },
        }
      );
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function nodeQueryOptions(nodeId: string) {
  return queryOptions({
    queryKey: ["nodes", nodeId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/nodes/{nodeId}", {
        params: { path: { nodeId } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function nodeChildrenQueryOptions(nodeId: string) {
  return queryOptions({
    queryKey: ["nodes", nodeId, "children"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/nodes/{nodeId}/children",
        { params: { path: { nodeId } } }
      );
      if (error) throw apiError(error);
      return data;
    },
  });
}
