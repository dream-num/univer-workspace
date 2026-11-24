import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import { worktreeHtmlViewDraftsQueryOptions } from "../html-views/drafts/draft-queries";
import { worktreesQueryKey } from "./worktrees.queries";

type WorktreeUnit = components["schemas"]["WorktreeUnit"];
type ReviewAction = "markReady" | "reopen" | "merge" | "discard";

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
    mutationFn: async ({ action: value, pageDraftIds }: {
      readonly action: ReviewAction;
      readonly pageDraftIds?: readonly string[] | undefined;
    }) => {
      const result =
        value === "markReady"
          ? await api.POST("/api/worktrees/{worktreeId}/ready", {
              params: { path: { worktreeId } },
            })
          : value === "reopen"
            ? await api.POST("/api/worktrees/{worktreeId}/reopen", {
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
                  ...(pageDraftIds === undefined ? {} : { body: { pageDraftIds: [...pageDraftIds] } }),
                })
              : await api.POST("/api/worktrees/{worktreeId}/discard", {
                  params: {
                    path: { worktreeId },
                    header: {
                      "Idempotency-Key": createIdempotencyKey(),
                    },
                  },
                });
      if (result.error) {
        const error = apiError(result.error);
        if (error.code === "PAGES_CHANGED") {
          await Promise.all([worktreeHtmlViewDraftsQueryOptions(worktreeId).queryKey, worktreesQueryKey]
            .map((queryKey) => client.invalidateQueries({ queryKey })));
        }
        throw error;
      }
      return {
        publishedPages: "publishedPages" in result.data ? result.data.publishedPages : [],
        action: value,
        state: "worktree" in result.data ? result.data.worktree.state : null,
      };
    },
    onSuccess: async ({ publishedPages }) => {
      await Promise.all([worktreesQueryKey, ["html-view-drafts"], ...(publishedPages.length ? [["nodes"], ["resources"], ["apps"]] : [])]
        .map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}
