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

  it("reports reopening only after the Worktree returns to draft", () => {
    expect(reviewActionFeedback("reopen", "draft")).toEqual({
      kind: "success",
      message: "taskReopened",
    });
    expect(reviewActionFeedback("reopen", "ready")).toEqual({
      kind: "info",
      message: "taskActionPending",
    });
    expect(reviewActionFeedback("reopen", null)).toEqual({
      kind: "info",
      message: "taskActionPending",
    });
  });
});
