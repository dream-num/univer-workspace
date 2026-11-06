import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { filtersFromSearch, searchFromFilters, validateIssueSearch, type IssueFilters } from "../features/issues";
import { ResourceUnavailablePage } from "../features/nodes";
import { ensureSpace, spaceQueryOptions } from "../features/spaces";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/spaces_/$spaceId/issues/")({
  validateSearch: validateIssueSearch,
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    const space = await ensureSpace(context.queryClient, params.spaceId);
    if (space.type !== "team") {
      throw notFound();
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: SpaceIssuesPage,
});

function SpaceIssuesPage() {
  const { pages } = useModeDefinition();
  const { spaceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const spaces = useQuery(spaceQueryOptions(spaceId));
  const space = spaces.data;
  return (
    <pages.issueList
      spaceId={spaceId}
      filters={filtersFromSearch(search)}
      onFiltersChange={(filters: IssueFilters) =>
        void navigate({
          to: "/spaces/$spaceId/issues",
          params: { spaceId },
          search: searchFromFilters(filters),
          replace: true,
        })
      }
      canCreate={space?.capabilities.createIssue ?? false}
    />
  );
}
