export type WorktreeReviewView = "comparison" | "trunk" | "agent" | "preview";

export const DEFAULT_WORKTREE_REVIEW_VIEW: WorktreeReviewView = "agent";

export interface WorktreeDashboardSearch {
  readonly spaceId?: string;
  readonly worktree?: string;
  readonly unit?: string;
  readonly view?: WorktreeReviewView;
  readonly section?: "overview" | "files";
  readonly scope?: "active" | "processed";
  readonly q?: string;
  readonly kind?: "user" | "team";
  readonly teamSpaceId?: string;
}

export function parseWorktreeDashboardSearch(
  search: Readonly<Record<string, unknown>>,
): WorktreeDashboardSearch {
  const spaceId = typeof search.spaceId === "string" && search.spaceId ? search.spaceId : undefined;
  const worktree =
    typeof search.worktree === "string" && search.worktree ? search.worktree : undefined;
  const unit = typeof search.unit === "string" && search.unit ? search.unit : undefined;
  return {
    ...(spaceId === undefined ? {} : { spaceId }),
    ...(worktree === undefined ? {} : { worktree }),
    ...(unit === undefined ? {} : { unit }),
    ...optionalReviewView(search.view),
    ...(search.section === "overview" || search.section === "files"
      ? { section: search.section }
      : {}),
    ...(search.scope === "active" || search.scope === "processed" ? { scope: search.scope } : {}),
    ...(typeof search.q === "string" && search.q.trim() ? { q: search.q.slice(0, 200) } : {}),
    ...(search.kind === "user" || search.kind === "team" ? { kind: search.kind } : {}),
    ...(typeof search.teamSpaceId === "string" && search.teamSpaceId
      ? { teamSpaceId: search.teamSpaceId }
      : {}),
  };
}

export function reviewViewForOpenMode(mode: string): WorktreeReviewView {
  if (mode === "trunk") return "trunk";
  return mode === "mergePreview" ? "preview" : "agent";
}

function optionalReviewView(value: unknown): Readonly<{ view?: WorktreeReviewView }> {
  return value === "agent" || value === "comparison" || value === "trunk" || value === "preview"
    ? { view: value }
    : {};
}
