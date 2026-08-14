import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const trashQueryKey = (spaceId: string) =>
  ["trash", spaceId] as const;

export function trashQueryOptions(spaceId: string) {
  return queryOptions({
    queryKey: trashQueryKey(spaceId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/spaces/{spaceId}/trash",
        {
          params: { path: { spaceId } },
        }
      );
      if (error) throw apiError(error);
      return data;
    },
  });
}
