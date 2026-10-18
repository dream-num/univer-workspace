import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/apps")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(typeof search.node === "string" && search.node ? { node: search.node } : {}),
    ...(typeof search.spaceId === "string" && search.spaceId ? { spaceId: search.spaceId } : {}),
    ...(typeof search.q === "string" && search.q ? { q: search.q.slice(0, 200) } : {}),
  }),
  loader: ({ context, location }) =>
    requireAuthenticatedSession(context.queryClient, location.href),
  component: AppsPage,
});

function AppsPage() {
  const { pages } = useModeDefinition();
  return <pages.apps {...Route.useSearch()} />;
}
