export type WorktreeReviewView = "trunk" | "agent" | "preview";

export interface WorktreeDashboardSearch {
  readonly worktree?: string;
  readonly unit?: string;
  readonly view?: WorktreeReviewView;
}

export function parseWorktreeDashboardSearch(
  search: Readonly<Record<string, unknown>>
): WorktreeDashboardSearch {
  const worktree =
    typeof search.worktree === "string" && search.worktree
      ? search.worktree
      : undefined;
  const unit =
    typeof search.unit === "string" && search.unit
      ? search.unit
      : undefined;
  return {
    ...(worktree === undefined ? {} : { worktree }),
    ...(unit === undefined ? {} : { unit }),
    ...optionalReviewView(search.view),
  };
}

export function reviewViewForOpenMode(
  mode: string
): WorktreeReviewView {
  if (mode === "trunk") return "trunk";
  return mode === "mergePreview" ? "preview" : "agent";
}

function optionalReviewView(
  value: unknown
): Readonly<{ view?: WorktreeReviewView }> {
  return value === "agent" ||
    value === "trunk" ||
    value === "preview"
    ? { view: value }
    : {};
}
