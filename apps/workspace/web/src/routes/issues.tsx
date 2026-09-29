import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import {
  IssueList,
  filtersFromSearch,
  searchFromFilters,
  validateIssueSearch,
  type IssueFilters,
} from "../features/issues";
import { spacesQueryOptions } from "../features/spaces";
import { IssueRouteLayout } from "./-issue-layout";

export const Route = createFileRoute("/issues")({
  validateSearch: validateIssueSearch,
  loader: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await context.queryClient.ensureQueryData(spacesQueryOptions);
  },
  component: MyIssuesPage,
});

function MyIssuesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <IssueRouteLayout>
      <IssueList
        filters={filtersFromSearch(search)}
        onFiltersChange={(filters: IssueFilters) =>
          void navigate({ to: "/issues", search: searchFromFilters(filters), replace: true })
        }
      />
    </IssueRouteLayout>
  );
}
