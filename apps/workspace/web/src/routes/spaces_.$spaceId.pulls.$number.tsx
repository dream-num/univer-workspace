import { createFileRoute, notFound } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { ResourceUnavailablePage, isResourceUnavailableError } from "../features/nodes";
import { worktreeByNumberQueryOptions, worktreeQueryOptions } from "../features/worktrees";
import { parseWorktreeDashboardSearch } from "../features/worktrees/worktree-review-search";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/spaces_/$spaceId/pulls/$number")({
  // Only the review selection is part of the address; list filters belong to /worktrees.
  validateSearch: (search) => {
    const { unit, view, section } = parseWorktreeDashboardSearch(search);
    return {
      ...(unit === undefined ? {} : { unit }),
      ...(view === undefined ? {} : { view }),
      ...(section === undefined ? {} : { section }),
    };
  },
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    if (!/^[1-9]\d{0,9}$/.test(params.number)) throw notFound();
    try {
      const result = await context.queryClient.fetchQuery(
        worktreeByNumberQueryOptions(params.spaceId, Number(params.number)),
      );
      // The detail page reads the same Worktree by ID; seed it instead of fetching twice.
      context.queryClient.setQueryData(worktreeQueryOptions(result.worktree.id).queryKey, result);
      return { worktreeId: result.worktree.id };
    } catch (error) {
      if (isResourceUnavailableError(error)) throw notFound();
      throw error;
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: PullRequestPage,
});

function PullRequestPage() {
  const { pages } = useModeDefinition();
  const { spaceId } = Route.useParams();
  const { worktreeId } = Route.useLoaderData();
  const search = Route.useSearch();
  return <pages.worktrees spaceId={spaceId} worktree={worktreeId} {...search} />;
}
