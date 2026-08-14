import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export function resourceOpenQueryOptions(resourceId: string) {
  return queryOptions({
    queryKey: ["resources", resourceId, "open"] as const,
    queryFn: async () => {
      const { data, error } = await api.POST(
        "/api/resources/{resourceId}/open",
        { params: { path: { resourceId } } }
      );
      if (error) throw apiError(error);
      return data;
    },
    staleTime: 30_000,
  });
}
