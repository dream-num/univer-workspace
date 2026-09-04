import type { components } from "../../../../generated/http/schema.js";
import type { MergeReviewStatus } from "../editor/merge-review";
import type { WorktreeReviewView } from "./worktree-review-search";

type WorktreeDetail = components["schemas"]["WorktreeDetail"];
type WorktreeUnit = components["schemas"]["WorktreeUnit"];
export type WorktreeReviewMode = "view" | "compare";

export function formatWorktreeDateTime(
  value: string,
  language: "zh-CN" | "en-US"
): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function resolveReviewView(
  worktree: Pick<WorktreeDetail, "state">,
  unit: Pick<WorktreeUnit, "source" | "activationState">,
  selectedView: WorktreeReviewView,
  mergeReviewStatus: MergeReviewStatus | undefined
): WorktreeReviewView {
  const canViewTrunk =
    unit.source === "trunk" || unit.activationState === "completed";
  const canViewMergePreview =
    worktree.state === "ready" && mergeReviewStatus === "preview";
  if (selectedView === "trunk" && canViewTrunk) return "trunk";
  if (selectedView === "preview" && canViewMergePreview) return "preview";
  if (selectedView === "agent") return "agent";
  return "comparison";
}

export function reviewModeForView(
  view: WorktreeReviewView
): WorktreeReviewMode {
  return view === "comparison" ? "compare" : "view";
}

export function reviewViewForMode(
  mode: WorktreeReviewMode
): WorktreeReviewView {
  return mode === "compare" ? "comparison" : "agent";
}
