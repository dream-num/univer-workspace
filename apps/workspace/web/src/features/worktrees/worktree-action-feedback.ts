import type { components } from "../../../../generated/http/schema.js";
import type { MessageKey } from "../../shared/i18n";

type WorktreeState = components["schemas"]["WorktreeState"];
type ReviewAction = "markReady" | "merge" | "discard";

export interface ReviewActionFeedback {
  readonly kind: "success" | "error" | "info";
  readonly message: MessageKey;
}

export function reviewActionFeedback(
  action: ReviewAction,
  state: WorktreeState | null
): ReviewActionFeedback {
  if (state === null) {
    return { kind: "info", message: "taskActionPending" };
  }
  if (action === "markReady") {
    return { kind: "success", message: "taskSubmittedForReview" };
  }
  if (action === "discard") {
    return { kind: "success", message: "taskChangesDiscarded" };
  }
  return state === "merged"
    ? { kind: "success", message: "taskMerged" }
    : { kind: "error", message: "taskMergeIncomplete" };
}
