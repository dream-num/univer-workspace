import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/recent")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q.slice(0, 200) } : {}),
  }),
  loader: ({ context, location }) =>
    requireAuthenticatedSession(context.queryClient, location.href),
  component: RecentPage,
});

function RecentPage() {
  const { pages } = useModeDefinition();
  return <pages.recent {...Route.useSearch()} />;
}
