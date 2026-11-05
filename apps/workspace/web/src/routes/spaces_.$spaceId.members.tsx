import { useModeDefinition } from "../modes/registry";

import { createFileRoute } from "@tanstack/react-router";

import { teamMembersQueryOptions } from "../features/permissions";
import { requireAuthenticatedSession } from "../features/auth";
import { ensureSpace } from "../features/spaces";

export const Route = createFileRoute("/spaces_/$spaceId/members")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await Promise.all([
      ensureSpace(context.queryClient, params.spaceId),
      context.queryClient.ensureQueryData(teamMembersQueryOptions(params.spaceId)),
    ]);
  },
  component: TeamMembersPage,
});

function TeamMembersPage() {
  const props = Route.useParams();
  const { pages } = useModeDefinition();
  return <pages.members {...props} />;
}
