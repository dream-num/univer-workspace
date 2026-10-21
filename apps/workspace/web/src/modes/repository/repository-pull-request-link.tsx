import { Link, useNavigate } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import type {
  WorktreeReviewView,
} from "../../features/worktrees/worktree-review-search";
import type { WorktreeListFilters } from "../../features/worktrees/worktrees.queries";

export interface PullRequestTarget {
  /** Unknown only for a User Worktree listed before the Personal Space is known. */
  readonly spaceId: string | undefined;
  readonly worktree: { readonly id: string; readonly number: number | null };
  readonly unit?: string | undefined;
  readonly view?: WorktreeReviewView | undefined;
  readonly section?: "overview" | "files" | undefined;
  readonly listFilters?: WorktreeListFilters | undefined;
}

/**
 * A numbered pull request lives at `/spaces/<id>/pulls/<n>`; old Worktrees without a
 * number keep the `/worktrees?worktree=<id>` form. List filters only apply to the latter.
 */
function numberedSearch({ unit, view, section }: PullRequestTarget) {
  return {
    ...(unit ? { unit } : {}),
    ...(view ? { view } : {}),
    ...(section ? { section } : {}),
  };
}

function legacySearch(target: PullRequestTarget) {
  return {
    ...target.listFilters,
    ...(target.spaceId ? { spaceId: target.spaceId } : {}),
    worktree: target.worktree.id,
    ...numberedSearch(target),
  };
}

export function PullRequestLink({
  target,
  children,
  ...rest
}: {
  readonly target: PullRequestTarget;
  readonly children: ReactNode;
} & Pick<ComponentProps<typeof Link>, "className" | "aria-current" | "activeOptions">) {
  const { worktree, spaceId } = target;
  return worktree.number === null || spaceId === undefined ? (
    <Link to="/worktrees" search={legacySearch(target)} {...rest}>
      {children}
    </Link>
  ) : (
    <Link
      to="/spaces/$spaceId/pulls/$number"
      params={{ spaceId, number: String(worktree.number) }}
      search={numberedSearch(target)}
      {...rest}
    >
      {children}
    </Link>
  );
}

export function usePullRequestNavigate() {
  const navigate = useNavigate();
  return (target: PullRequestTarget) => {
    const { worktree, spaceId } = target;
    return worktree.number === null || spaceId === undefined
      ? navigate({ to: "/worktrees", search: legacySearch(target) })
      : navigate({
          to: "/spaces/$spaceId/pulls/$number",
          params: { spaceId, number: String(worktree.number) },
          search: numberedSearch(target),
        });
  };
}
