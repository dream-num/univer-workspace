import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/agents/$sessionId")({
  loader: async ({ context, location }) => { await requireAuthenticatedSession(context.queryClient, location.href); },
  component: AgentSessionPage,
});
function AgentSessionPage() {
  const { pages } = useModeDefinition();
  return <pages.agentSession sessionId={Route.useParams().sessionId} />;
}
