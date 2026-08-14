import type { SaveSnapshotInput } from "@univerjs-pro/collaboration-service";
import type { WorktreeUnitMergeEvaluation } from "@univerjs-pro/collaboration-worktree-service";

export type MergeReviewResolution =
  | { readonly kind: "worktree" }
  | {
      readonly kind: "preview";
      readonly preview: SaveSnapshotInput;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "conflict" | "missing";
    };

export type MergeReviewStatus =
  | "notBehind"
  | "preview"
  | "conflict"
  | "unavailable";

export function resolveMergeReview(
  evaluation: WorktreeUnitMergeEvaluation | undefined
): MergeReviewResolution {
  if (evaluation?.status === "not-behind") {
    return { kind: "worktree" };
  }
  if (evaluation?.status === "preview") {
    return { kind: "preview", preview: evaluation.preview };
  }
  return {
    kind: "unavailable",
    reason: evaluation?.status === "conflict" ? "conflict" : "missing",
  };
}

export function resolveMergeReviewStatus(
  evaluation: WorktreeUnitMergeEvaluation | undefined
): MergeReviewStatus {
  const resolution = resolveMergeReview(evaluation);
  if (resolution.kind === "worktree") return "notBehind";
  if (resolution.kind === "preview") return "preview";
  return resolution.reason === "conflict"
    ? "conflict"
    : "unavailable";
}
