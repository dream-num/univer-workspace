import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { ensureSpace } from "../features/spaces";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/spaces_/$spaceId/agents")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await ensureSpace(context.queryClient, params.spaceId);
  },
  component: AgentsPage,
});
function AgentsPage() {
  const { pages } = useModeDefinition();
  return <pages.agents spaceId={Route.useParams().spaceId} />;
}
