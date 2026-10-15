import { useModeDefinition } from "../modes/registry";
import { createFileRoute } from "@tanstack/react-router";

import { trashQueryOptions } from "../features/trash";
import { requireAuthenticatedSession } from "../features/auth";

export const Route = createFileRoute("/spaces_/$spaceId/trash")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await context.queryClient.ensureQueryData(trashQueryOptions(params.spaceId));
  },
  component: SpaceTrashPage,
});

function SpaceTrashPage() {
  const props = Route.useParams();
  const { pages } = useModeDefinition();
  return <pages.trash {...props} />;
}
