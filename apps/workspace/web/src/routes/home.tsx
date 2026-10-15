import { useModeDefinition } from "../modes/registry";
import type { HomeView } from "../modes/registry";
import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { spacesQueryOptions } from "../features/spaces";
import { ownedByMeQueryOptions, recentResourcesQueryOptions, sharedWithMeQueryOptions } from "../features/views";

export const Route = createFileRoute("/home")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(isHomeView(search.view) ? { view: search.view } : {}),
  }),
  loader: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await Promise.all([
      context.queryClient.ensureQueryData(recentResourcesQueryOptions),
      context.queryClient.ensureQueryData(ownedByMeQueryOptions),
      context.queryClient.ensureQueryData(sharedWithMeQueryOptions),
      context.queryClient.ensureQueryData(spacesQueryOptions),
    ]);
  },
  component: HomePage,
});

function isHomeView(value: unknown): value is HomeView {
  return value === "recent" || value === "owned" || value === "shared";
}

function HomePage() {
  const props = Route.useSearch();
  const { pages } = useModeDefinition();
  return <pages.home {...props} />;
}
