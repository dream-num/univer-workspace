import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_ISSUE_FILTERS, issueLabelsQueryOptions, issueListQueryOptions, type IssueFilters } from "./issues.queries";

export interface IssueListModelProps {
  readonly spaceId?: string;
  readonly filters: IssueFilters;
  readonly onFiltersChange: (filters: IssueFilters) => void;
}

export const ISSUE_FILTER_ANY = "__any";
export const ISSUE_SORTS = ["created-desc", "created-asc", "updated-desc", "updated-asc"] as const;
export const ISSUE_SORT_LABELS = {
  "created-desc": "issueSortNewest",
  "created-asc": "issueSortOldest",
  "updated-desc": "issueSortRecentlyUpdated",
  "updated-asc": "issueSortLeastRecentlyUpdated",
} as const;

export function useIssueListModel({ spaceId, filters, onFiltersChange }: IssueListModelProps) {
  const query = useInfiniteQuery(issueListQueryOptions(spaceId, filters));
  const labels = useQuery({
    ...issueLabelsQueryOptions(spaceId ?? ""),
    enabled: spaceId !== undefined,
  });
  const [search, setSearch] = useState(filters.q ?? "");
  useEffect(() => setSearch(filters.q ?? ""), [filters.q]);

  const pages = query.data?.pages ?? [];
  const issues = pages.flatMap((page) => page.items);
  const counts = pages[0]?.counts ?? { open: 0, closed: 0 };
  const narrowed =
    filters.labels.length > 0 ||
    Boolean(filters.assignee) ||
    Boolean(filters.author) ||
    Boolean(filters.q);
  const submitSearch = (event: Pick<FormEvent, "preventDefault">) => {
    event.preventDefault();
    onFiltersChange({ ...filters, q: search.trim() || undefined });
  };

  const clearSearch = () => {
    setSearch("");
    onFiltersChange({ ...filters, q: undefined });
  };
  const resetFilters = () => {
    setSearch("");
    onFiltersChange({ ...DEFAULT_ISSUE_FILTERS, state: filters.state });
  };
  const clearNarrowing = () => onFiltersChange({
    ...filters,
    labels: [],
    assignee: undefined,
    author: undefined,
    q: undefined,
  });
  return { query, labels, issues, counts, narrowed, search, setSearch, submitSearch, clearSearch, resetFilters, clearNarrowing };
}
