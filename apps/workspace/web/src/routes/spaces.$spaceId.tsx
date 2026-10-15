import type { SpacePageView as RepositoryView } from "../modes/registry";
import { useModeDefinition } from "../modes/registry";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { ResourceUnavailablePage, isResourceUnavailableError, spaceNodesQueryOptions } from "../features/nodes";
import { sessionQueryOptions } from "../features/auth";
import { spacesQueryOptions } from "../features/spaces";

export const Route = createFileRoute("/spaces/$spaceId")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(isRepositoryView(search.view) ? { view: search.view } : {}),
  }),
  loader: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    try {
      await Promise.all([
        session.authenticated ? context.queryClient.ensureQueryData(spacesQueryOptions) : undefined,
        context.queryClient.ensureQueryData(spaceNodesQueryOptions(params.spaceId)),
      ]);
    } catch (error) {
      if (isResourceUnavailableError(error)) throw notFound();
      throw error;
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: SpaceNodePage,
});

/** Mirrors GitHub's About sidebar; only fields Workspace stores are shown. */

function isRepositoryView(value: unknown): value is RepositoryView {
  return value === "files" || value === "prs" || value === "apps";
}

function SpaceNodePage() {
  const props = { ...Route.useParams(), ...Route.useSearch() };
  const { pages } = useModeDefinition();
  return <pages.space {...props} />;
}
