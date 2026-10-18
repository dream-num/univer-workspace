import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { parseRepositorySearch, useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/repositories")({
  validateSearch: parseRepositorySearch,
  loader: ({ context, location }) =>
    requireAuthenticatedSession(context.queryClient, location.href),
  component: RepositoriesPage,
});

function RepositoriesPage() {
  const { pages } = useModeDefinition();
  return <pages.repositories {...Route.useSearch()} />;
}
