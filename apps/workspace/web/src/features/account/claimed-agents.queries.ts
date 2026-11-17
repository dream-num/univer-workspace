import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const claimedAgentsQueryOptions = queryOptions({
  queryKey: ["claimed-agents"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/agents");
    if (error) throw apiError(error);
    return data;
  },
});

export function agentClaimQueryOptions(code: string) {
  return queryOptions({
    queryKey: ["agent-claim", code],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/agents/claim", { params: { query: { code } } });
      if (error) throw apiError(error);
      return data;
    },
    retry: false,
  });
}

export async function claimAgent(code: string) {
  const { data, error } = await api.POST("/api/agents/claim", { body: { code } });
  if (error) throw apiError(error);
  return data;
}

export async function stopAgent(agentId: string) {
  const { error } = await api.POST("/api/agents/{agentId}/stop", { params: { path: { agentId } } });
  if (error) throw apiError(error);
}
