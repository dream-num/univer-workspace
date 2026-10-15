import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { invalidateProductLists } from "../nodes/nodes.commands";
import { trashQueryKey } from "./trash.queries";

export function useRestoreTrashBatch(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (trashBatchId: string) => {
      const { error } = await api.POST("/api/trash-batches/{trashBatchId}/restore", {
        params: { path: { trashBatchId } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: trashQueryKey(spaceId) });
      await invalidateProductLists(client);
    },
  });
}

export function usePurgeTrashBatch(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (trashBatchId: string) => {
      const { error } = await api.DELETE("/api/trash-batches/{trashBatchId}", {
        params: { path: { trashBatchId } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: trashQueryKey(spaceId) }),
  });
}
