import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { UnitComparisonViewerValue } from "@univer/unit-comparison-viewer";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { resolveMergeReviewStatus, type MergeReviewStatus } from "../editor/merge-review";

export const worktreesQueryKey = ["worktrees"] as const;

// Home stays bounded even when the full list has many cached pages.
export const worktreeSummaryQueryOptions = queryOptions({
  queryKey: [...worktreesQueryKey, "summary"] as const,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/worktrees", {
      params: { query: { scope: "active", limit: 5, order: "updatedAtDesc" } },
    });
    if (error) throw apiError(error);
    return data;
  },
});

export interface WorktreeListFilters {
  readonly scope?: "active" | "processed";
  readonly q?: string;
  readonly kind?: "user" | "team";
  readonly teamSpaceId?: string;
}

export function worktreePagesQueryOptions(filters: WorktreeListFilters = {}) {
  return infiniteQueryOptions({
    queryKey: [...worktreesQueryKey, "pages", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET("/api/worktrees", {
        params: {
          query: {
            scope: filters.scope ?? "active",
            limit: 20,
            order: "updatedAtDesc",
            ...(filters.q ? { search: filters.q } : {}),
            ...(filters.kind ? { kind: filters.kind } : {}),
            ...(filters.teamSpaceId ? { teamSpaceId: filters.teamSpaceId } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      });
      if (error) throw apiError(error);
      return data;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function worktreeListQueryOptions(scope: "active" | "processed") {
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
      const { data, error } = await api.GET("/api/worktrees/{worktreeId}", {
        params: { path: { worktreeId } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function worktreeByNumberQueryOptions(spaceId: string, number: number) {
  return queryOptions({
    queryKey: [...worktreesQueryKey, "number", spaceId, number] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/spaces/{spaceId}/worktrees/{number}", {
        params: { path: { spaceId, number } },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function worktreeUnitOpenQueryOptions(
  worktreeId: string,
  unitId: string,
  mode: "draft" | "trunk" | "mergePreview",
) {
  return queryOptions({
    queryKey: [...worktreesQueryKey, "open", worktreeId, unitId, mode] as const,
    queryFn: async () => {
      const { data, error } = await api.POST("/api/worktrees/{worktreeId}/units/{unitId}/open", {
        params: { path: { worktreeId, unitId } },
        body: { mode },
      });
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function worktreeUnitMergeReviewQueryOptions(worktreeId: string, unitId: string) {
  return queryOptions({
    queryKey: [...worktreesQueryKey, "merge-review", worktreeId, unitId] as const,
    queryFn: async (): Promise<MergeReviewStatus> => {
      const response = await fetch(
        `/universer-api/worktrees/${encodeURIComponent(
          worktreeId,
        )}/units/${encodeURIComponent(unitId)}/merge-preview`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("The merge preview could not be prepared.");
      }
      const body = (await response.json()) as {
        readonly evaluation?: Parameters<typeof resolveMergeReviewStatus>[0];
      };
      return resolveMergeReviewStatus(body.evaluation);
    },
  });
}

export interface WorktreeUnitComparisonPayload {
  readonly result: UnitComparisonViewerValue["result"];
  readonly left: {
    readonly revision?: number;
    readonly unitData: unknown | null;
  };
  readonly right: {
    readonly revision?: number;
    readonly unitData: unknown | null;
  };
}

export function worktreeUnitComparisonQueryOptions(worktreeId: string, unitId: string) {
  return queryOptions({
    queryKey: [...worktreesQueryKey, "comparison", worktreeId, unitId] as const,
    staleTime: Infinity,
    queryFn: async (): Promise<WorktreeUnitComparisonPayload> => {
      const response = await fetch(
        `/universer-api/worktrees/${encodeURIComponent(
          worktreeId,
        )}/units/${encodeURIComponent(unitId)}/comparison`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("The Unit comparison could not be prepared.");
      }
      return (await response.json()) as WorktreeUnitComparisonPayload;
    },
  });
}
