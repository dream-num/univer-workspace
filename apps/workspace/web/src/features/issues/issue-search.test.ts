import { describe, expect, it } from "vitest";
import { filtersFromSearch, searchFromFilters, validateIssueSearch } from "./issue-search";
import { DEFAULT_ISSUE_FILTERS } from "./issues.queries";

describe("Issue list URL state", () => {
  it("keeps defaults out of the URL and restores them from an empty one", () => {
    expect(searchFromFilters(DEFAULT_ISSUE_FILTERS)).toEqual({});
    expect(filtersFromSearch({})).toEqual(expect.objectContaining(DEFAULT_ISSUE_FILTERS));
  });

  it("round-trips every non-default filter", () => {
    const filters = {
      state: "all" as const,
      labels: ["bug", "docs"],
      assignee: "me",
      author: "me",
      q: "budget",
      sort: "updated" as const,
      order: "asc" as const,
    };
    expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters);
  });

  it("drops malformed and empty values from a hand-edited URL", () => {
    expect(
      validateIssueSearch({ state: "bogus", label: ["ok", 3, ""], assignee: " ", q: 7, sort: "created", order: "up" }),
    ).toEqual({ label: ["ok"] });
    expect(validateIssueSearch({ label: "single" })).toEqual({ label: ["single"] });
  });
});
