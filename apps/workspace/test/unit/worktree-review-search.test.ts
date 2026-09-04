import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKTREE_REVIEW_VIEW,
  parseWorktreeDashboardSearch,
  reviewViewForOpenMode,
} from "../../web/src/features/worktrees/worktree-review-search.js";

describe("parseWorktreeDashboardSearch", () => {
  it("keeps the existing agent view as the default", () => {
    expect(DEFAULT_WORKTREE_REVIEW_VIEW).toBe("agent");
  });

  it("keeps the selected Worktree, Unit, and version", () => {
    expect(
      parseWorktreeDashboardSearch({
        worktree: "wt-1",
        unit: "unit-1",
        view: "agent",
      })
    ).toEqual({
      worktree: "wt-1",
      unit: "unit-1",
      view: "agent",
    });
  });

  it.each([undefined, null, "", 1])(
    "ignores invalid Unit selection %j",
    (unit) => {
      expect(parseWorktreeDashboardSearch({ unit })).toEqual({});
    }
  );

  it.each([undefined, null, "", "draft", 1])(
    "ignores invalid review view %j",
    (view) => {
      expect(parseWorktreeDashboardSearch({ view })).toEqual({});
    }
  );

  it("accepts the comparison review view", () => {
    expect(parseWorktreeDashboardSearch({ view: "comparison" })).toEqual({
      view: "comparison",
    });
  });
});

describe("reviewViewForOpenMode", () => {
  it.each([
    ["trunk", "trunk"],
    ["draft", "agent"],
    ["mergePreview", "preview"],
  ] as const)("maps %s to %s", (mode, view) => {
    expect(reviewViewForOpenMode(mode)).toBe(view);
  });
});
