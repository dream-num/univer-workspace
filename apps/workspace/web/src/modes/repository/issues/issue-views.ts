import type { IssueFilters } from "../../../features/issues/issues.queries";
import { searchFromFilters } from "../../../features/issues/issue-search";

export type IssueView = "all" | "assigned" | "created" | "recent";

export function issueViewSearch(filters: IssueFilters, view: IssueView) {
  return searchFromFilters({
    ...filters,
    assignee: view === "assigned" ? "me" : undefined,
    author: view === "created" ? "me" : undefined,
    sort: view === "recent" ? "updated" : "created",
    order: "desc",
  });
}

export function activeIssueView(filters: IssueFilters): IssueView | undefined {
  if (filters.assignee === "me" && !filters.author) return "assigned";
  if (filters.author === "me" && !filters.assignee) return "created";
  if (filters.assignee || filters.author) return undefined;
  return filters.sort === "updated" ? "recent" : "all";
}
