import { useModeDefinition } from "../modes/registry";

import { createFileRoute, notFound } from "@tanstack/react-router";

import { requireAuthenticatedSession } from "../features/auth";

import { ensureSpace } from "../features/spaces";
import {
  ResourceUnavailablePage,
  isResourceUnavailableError,
  spaceNodesQueryOptions,
} from "../features/nodes";

export const Route = createFileRoute("/spaces_/$spaceId/settings")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    try {
      await Promise.all([
        ensureSpace(context.queryClient, params.spaceId),
        context.queryClient.ensureQueryData(spaceNodesQueryOptions(params.spaceId)),
      ]);
    } catch (error) {
      if (isResourceUnavailableError(error)) throw notFound();
      throw error;
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: SpaceSettingsPage,
});

function SpaceSettingsPage() {
  const props = Route.useParams();
  const { pages } = useModeDefinition();
  return <pages.settings {...props} />;
}
