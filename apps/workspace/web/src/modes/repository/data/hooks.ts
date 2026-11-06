import { useQueries, useQuery } from "@tanstack/react-query";
import { worktreeQueryOptions } from "../../../features/worktrees/worktrees.queries";
import { mySpacesQueryOptions } from "../../../features/spaces";
import { buildRepositoryActivity } from "./activity";
import { dayWindow } from "./days";
import { buildHomeWork } from "./home-work";
import { buildIssueFacets } from "./issue-facets";
import { buildPendingIndex, pendingAncestryPlan, pendingDetailPlan, type NodeAncestry } from "./pending";
import {
  ancestryQueryOptions,
  homeQueries,
  issueWindowQueryOptions,
  openIssueFacetsQueryOptions,
  openWorktreesQueryOptions,
  worktreeWindowQueryOptions,
} from "./queries";
import type { HomeWork, IssueFacets, PendingChangeIndex, QueryView, RepositoryActivity, Space, WorktreeDetail } from "./types";

export function useRepositoryActivity(space: Space): QueryView<RepositoryActivity> {
  const window = dayWindow(new Date());
  return useQueries({
    queries: [worktreeWindowQueryOptions(space, window.startIso), issueWindowQueryOptions(space, window.startIso)],
    combine: ([pulls, issues]) => {
      if (pulls.isError) return { status: "error", error: pulls.error };
      if (issues.isError) return { status: "error", error: issues.error };
      if (!pulls.isSuccess || !issues.isSuccess) return { status: "pending" };
      return { status: "success", data: buildRepositoryActivity(window, pulls.data, issues.data) };
    },
  });
}

export function usePendingChanges(space: Space): QueryView<PendingChangeIndex> {
  const plan = useQueries({
    queries: [openWorktreesQueryOptions(space)],
    combine: ([list]): QueryView<ReturnType<typeof pendingDetailPlan>> => {
      if (list.isError) return { status: "error", error: list.error };
      if (!list.isSuccess) return { status: "pending" };
      return { status: "success", data: pendingDetailPlan(space, list.data) };
    },
  });
  const details = useQueries({
    queries: plan.status === "success" ? plan.data.items.map((item) => worktreeQueryOptions(item.id)) : [],
    combine: (results): QueryView<{ details: WorktreeDetail[]; complete: boolean }> => {
      if (plan.status !== "success") return plan;
      const failed = results.find((result) => result.isError);
      if (failed) return { status: "error", error: failed.error };
      if (results.some((result) => !result.isSuccess)) return { status: "pending" };
      return {
        status: "success",
        data: { details: results.flatMap((result) => result.data ? [result.data.worktree] : []), complete: plan.data.complete },
      };
    },
  });
  const ancestryPlan = pendingAncestryPlan(space.id, details.status === "success" ? details.data.details : []);
  return useQueries({
    queries: ancestryPlan.ids.map(ancestryQueryOptions),
    combine: (results): QueryView<PendingChangeIndex> => {
      if (details.status !== "success") return details;
      const failed = results.find((result) => result.isError);
      if (failed) return { status: "error", error: failed.error };
      if (results.some((result) => !result.isSuccess)) return { status: "pending" };
      const ancestry = new Map<string, NodeAncestry>();
      for (const result of results) {
        if (result.data?.ancestry) ancestry.set(result.data.nodeId, result.data.ancestry);
      }
      return {
        status: "success",
        data: buildPendingIndex(space.id, details.data.details, ancestry, details.data.complete && ancestryPlan.complete),
      };
    },
  });
}

export function useHomeWork(): QueryView<HomeWork> {
  const spaces = useQuery(mySpacesQueryOptions);
  const personalSpace = spaces.data?.spaces.find((space) => space.type === "personal" && space.accessRole === "owner");
  return useQueries({
    queries: homeQueries,
    combine: ([recent, pulls, issues]) => {
      if (recent.isError) return { status: "error", error: recent.error };
      if (pulls.isError) return { status: "error", error: pulls.error };
      if (issues.isError) return { status: "error", error: issues.error };
      if (!recent.isSuccess || !pulls.isSuccess || !issues.isSuccess) return { status: "pending" };
      return { status: "success", data: buildHomeWork(pulls.data, issues.data, recent.data.items, personalSpace) };
    },
  });
}

export function useOpenIssueFacets(spaceId: string, meUserId: string): QueryView<IssueFacets> {
  const now = new Date();
  return useQueries({
    queries: [openIssueFacetsQueryOptions(spaceId)],
    combine: ([issues]) => {
      if (issues.isError) return { status: "error", error: issues.error };
      if (!issues.isSuccess) return { status: "pending" };
      return { status: "success", data: buildIssueFacets(issues.data, meUserId, now) };
    },
  });
}
