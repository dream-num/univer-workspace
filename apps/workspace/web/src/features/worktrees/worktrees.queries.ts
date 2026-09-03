import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import {
  resolveMergeReviewStatus,
  type MergeReviewStatus,
} from "../editor/merge-review";

export const worktreesQueryKey = ["worktrees"] as const;

export function worktreeListQueryOptions(
  scope: "active" | "processed"
) {
  return queryOptions({
    queryKey: [...worktreesQueryKey, "list", scope] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/worktrees", {
        params: { query: { scope } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function worktreeQueryOptions(worktreeId: string) {
  return queryOptions({
    queryKey: [...worktreesQueryKey, "detail", worktreeId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/worktrees/{worktreeId}",
        { params: { path: { worktreeId } } }
      );
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function worktreeUnitOpenQueryOptions(
  worktreeId: string,
  unitId: string,
  mode: "draft" | "trunk" | "mergePreview"
) {
  return queryOptions({
    queryKey: [
      ...worktreesQueryKey,
      "open",
      worktreeId,
      unitId,
      mode,
    ] as const,
    queryFn: async () => {
      const { data, error } = await api.POST(
        "/api/worktrees/{worktreeId}/units/{unitId}/open",
        {
          params: { path: { worktreeId, unitId } },
          body: { mode },
        }
      );
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function worktreeUnitComparisonQueryOptions(
  worktreeId: string,
  unitId: string
) {
  return queryOptions({
    queryKey: [
      ...worktreesQueryKey,
      "comparison",
      worktreeId,
      unitId,
    ] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/worktrees/{worktreeId}/units/{unitId}/comparison",
        { params: { path: { worktreeId, unitId } } }
      );
      if (error) throw apiError(error);
      return data;
    },
    staleTime: 0,
  });
}

export function worktreeUnitMergeReviewQueryOptions(
  worktreeId: string,
  unitId: string
) {
  return queryOptions({
    queryKey: [
      ...worktreesQueryKey,
      "merge-review",
      worktreeId,
      unitId,
    ] as const,
    queryFn: async (): Promise<MergeReviewStatus> => {
      const response = await fetch(
        `/universer-api/worktrees/${encodeURIComponent(
          worktreeId
        )}/units/${encodeURIComponent(unitId)}/merge-preview`,
        { credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("The merge preview could not be prepared.");
      }
      const body = (await response.json()) as {
        readonly evaluation?: Parameters<
          typeof resolveMergeReviewStatus
        >[0];
      };
      return resolveMergeReviewStatus(body.evaluation);
    },
  });
}
