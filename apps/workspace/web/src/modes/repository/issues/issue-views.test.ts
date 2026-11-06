import { describe, expect, it } from "vitest";
import { filtersFromSearch } from "../../../features/issues/issue-search";
import { DEFAULT_ISSUE_FILTERS } from "../../../features/issues/issues.queries";
import { activeIssueView, issueViewSearch } from "./issue-views";

const filters = {
  ...DEFAULT_ISSUE_FILTERS,
  state: "closed" as const,
  q: "budget",
  labels: ["Data", "Approval"],
  assignee: "other-user",
  author: "other-author",
  sort: "updated" as const,
  order: "asc" as const,
};

describe("Repository issue views", () => {
  it.each(["all", "assigned", "created", "recent"] as const)("keeps state, search and labels when linking to %s", (view) => {
    const target = filtersFromSearch(issueViewSearch(filters, view));
    expect(target).toMatchObject({ state: "closed", q: "budget", labels: ["Data", "Approval"] });
    expect(activeIssueView(target)).toBe(view);
    expect(target.assignee).toBe(view === "assigned" ? "me" : undefined);
    expect(target.author).toBe(view === "created" ? "me" : undefined);
  });

  it("does not highlight a personal view for an arbitrary or combined user filter", () => {
    expect(activeIssueView(filters)).toBeUndefined();
    expect(activeIssueView({ ...filters, assignee: "me", author: "me" })).toBeUndefined();
  });
});
