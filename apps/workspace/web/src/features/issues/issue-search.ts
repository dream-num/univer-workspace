import { DEFAULT_ISSUE_FILTERS, type IssueFilters } from "./issues.queries";

/** URL form of the list filters. Defaults are omitted so shared links stay short. */
export interface IssueSearch {
  readonly state?: "closed" | "all";
  readonly label?: readonly string[];
  readonly assignee?: string;
  readonly author?: string;
  readonly q?: string;
  readonly sort?: "updated";
  readonly order?: "asc";
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function validateIssueSearch(search: Readonly<Record<string, unknown>>): IssueSearch {
  const label = Array.isArray(search["label"])
    ? search["label"].filter((item): item is string => typeof item === "string" && item !== "")
    : typeof search["label"] === "string" && search["label"] !== ""
      ? [search["label"]]
      : [];
  const assignee = text(search["assignee"]);
  const author = text(search["author"]);
  const q = text(search["q"]);
  return {
    ...(search["state"] === "closed" || search["state"] === "all" ? { state: search["state"] } : {}),
    ...(label.length ? { label } : {}),
    ...(assignee ? { assignee } : {}),
    ...(author ? { author } : {}),
    ...(q ? { q } : {}),
    ...(search["sort"] === "updated" ? { sort: "updated" as const } : {}),
    ...(search["order"] === "asc" ? { order: "asc" as const } : {}),
  };
}

export function filtersFromSearch(search: IssueSearch): IssueFilters {
  return {
    ...DEFAULT_ISSUE_FILTERS,
    state: search.state ?? DEFAULT_ISSUE_FILTERS.state,
    labels: search.label ?? [],
    assignee: search.assignee,
    author: search.author,
    q: search.q,
    sort: search.sort ?? DEFAULT_ISSUE_FILTERS.sort,
    order: search.order ?? DEFAULT_ISSUE_FILTERS.order,
  };
}

export function searchFromFilters(filters: IssueFilters): IssueSearch {
  return {
    ...(filters.state !== "open" ? { state: filters.state } : {}),
    ...(filters.labels.length ? { label: filters.labels } : {}),
    ...(filters.assignee ? { assignee: filters.assignee } : {}),
    ...(filters.author ? { author: filters.author } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.sort !== "created" ? { sort: "updated" as const } : {}),
    ...(filters.order !== "desc" ? { order: "asc" as const } : {}),
  };
}
