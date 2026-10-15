import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import { worktreesQueryKey } from "./worktrees.queries";

type WorktreeUnit = components["schemas"]["WorktreeUnit"];
type ReviewAction = "markReady" | "merge" | "discard";

export function useToggleUnitRemoval(worktreeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (unit: WorktreeUnit) => {
      const result = await api.POST("/api/worktrees/{worktreeId}/units/{unitId}/removal", {
        params: { path: { worktreeId, unitId: unit.unitId } },
        body: { removed: unit.change !== "deleted" },
      });
      if (result.error) throw apiError(result.error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: worktreesQueryKey }),
  });
}

export function useWorktreeLifecycle(worktreeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (value: ReviewAction) => {
      const result =
        value === "markReady"
          ? await api.POST("/api/worktrees/{worktreeId}/ready", {
              params: { path: { worktreeId } },
            })
          : value === "merge"
            ? await api.POST("/api/worktrees/{worktreeId}/merge", {
                params: {
                  path: { worktreeId },
                  header: {
                    "Idempotency-Key": createIdempotencyKey(),
                  },
                },
              })
            : await api.POST("/api/worktrees/{worktreeId}/discard", {
                params: {
                  path: { worktreeId },
                  header: {
                    "Idempotency-Key": createIdempotencyKey(),
                  },
                },
              });
      if (result.error) throw apiError(result.error);
      return {
        action: value,
        state: "worktree" in result.data ? result.data.worktree.state : null,
      };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: worktreesQueryKey }),
  });
}
