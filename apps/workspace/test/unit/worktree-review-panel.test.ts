import { describe, expect, it } from "vitest";
import {
  resolveReviewView,
  reviewModeForView,
  reviewViewForMode,
} from "../../web/src/features/worktrees/worktree-review-presentation.js";

const trunkUnit = {
  source: "trunk",
  activationState: "notApplicable",
} as const;
const draftUnit = {
  source: "worktree",
  activationState: "waitingForMerge",
} as const;

describe("resolveReviewView", () => {
  it("keeps the agent draft and comparison views available", () => {
    expect(
      resolveReviewView({ state: "ready" }, draftUnit, "agent", undefined)
    ).toBe("agent");
    expect(
      resolveReviewView(
        { state: "ready" },
        draftUnit,
        "comparison",
        undefined
      )
    ).toBe("comparison");
  });

  it("shows the official version only when Trunk is available", () => {
    expect(
      resolveReviewView({ state: "ready" }, trunkUnit, "trunk", undefined)
    ).toBe("trunk");
    expect(
      resolveReviewView({ state: "ready" }, draftUnit, "trunk", undefined)
    ).toBe("comparison");
  });

  it("shows merge preview only when the ready Worktree has one", () => {
    expect(
      resolveReviewView({ state: "ready" }, trunkUnit, "preview", "preview")
    ).toBe("preview");
    expect(
      resolveReviewView({ state: "draft" }, trunkUnit, "preview", "preview")
    ).toBe("comparison");
    expect(
      resolveReviewView({ state: "ready" }, trunkUnit, "preview", "conflict")
    ).toBe("comparison");
  });
});

describe("Worktree review mode", () => {
  it("uses the same view and compare modes as the CLI", () => {
    expect(reviewModeForView("agent")).toBe("view");
    expect(reviewModeForView("trunk")).toBe("view");
    expect(reviewModeForView("preview")).toBe("view");
    expect(reviewModeForView("comparison")).toBe("compare");
    expect(reviewViewForMode("view")).toBe("agent");
    expect(reviewViewForMode("compare")).toBe("comparison");
  });
});
