import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { filtersFromSearch, searchFromFilters, validateIssueSearch, type IssueFilters } from "../features/issues";
import { mySpacesQueryOptions } from "../features/spaces";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/issues")({
  validateSearch: validateIssueSearch,
  loader: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await context.queryClient.ensureQueryData(mySpacesQueryOptions);
  },
  component: MyIssuesPage,
});

function MyIssuesPage() {
  const { pages } = useModeDefinition();
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <pages.issueList
      filters={filtersFromSearch(search)}
      onFiltersChange={(filters: IssueFilters) =>
        void navigate({ to: "/issues", search: searchFromFilters(filters), replace: true })
      }
    />
  );
}
