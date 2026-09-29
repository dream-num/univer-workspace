import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import {
  IssueList,
  filtersFromSearch,
  searchFromFilters,
  validateIssueSearch,
  type IssueFilters,
} from "../features/issues";
import { ResourceUnavailablePage } from "../features/nodes";
import { spacesQueryOptions } from "../features/spaces";
import { IssueRouteLayout } from "./-issue-layout";

export const Route = createFileRoute("/spaces_/$spaceId/issues/")({
  validateSearch: validateIssueSearch,
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    const spaces = await context.queryClient.ensureQueryData(spacesQueryOptions);
    if (spaces.spaces.every((space) => space.id !== params.spaceId || space.type !== "team")) {
      throw notFound();
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: SpaceIssuesPage,
});

function SpaceIssuesPage() {
  const { spaceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  return (
    <IssueRouteLayout spaceId={spaceId}>
      <IssueList
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
    </IssueRouteLayout>
  );
}
