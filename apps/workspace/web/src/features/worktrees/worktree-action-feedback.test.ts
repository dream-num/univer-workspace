import { describe, expect, it } from "vitest";
import { reviewActionFeedback } from "./worktree-action-feedback";

describe("reviewActionFeedback", () => {
  it("reports a merge as successful only after the Worktree is merged", () => {
    expect(reviewActionFeedback("merge", "merged")).toEqual({
      kind: "success",
      message: "taskMerged",
    });
    expect(reviewActionFeedback("merge", "ready")).toEqual({
      kind: "error",
      message: "taskMergeIncomplete",
    });
    expect(reviewActionFeedback("merge", null)).toEqual({
      kind: "info",
      message: "taskActionPending",
    });
  });

  it("keeps the existing feedback for non-merge actions", () => {
    expect(reviewActionFeedback("markReady", "ready")).toEqual({
      kind: "success",
      message: "taskSubmittedForReview",
    });
    expect(reviewActionFeedback("discard", "discarded")).toEqual({
      kind: "success",
      message: "taskChangesDiscarded",
    });
  });
});
