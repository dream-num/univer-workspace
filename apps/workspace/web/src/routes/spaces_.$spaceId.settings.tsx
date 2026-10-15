import { useModeDefinition } from "../modes/registry";

import { createFileRoute, notFound } from "@tanstack/react-router";

import { requireAuthenticatedSession } from "../features/auth";

import { spacesQueryOptions } from "../features/spaces";
import {
  ResourceUnavailablePage,
  isResourceUnavailableError,
  spaceNodesQueryOptions,
} from "../features/nodes";

export const Route = createFileRoute("/spaces_/$spaceId/settings")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    try {
      const [spaces] = await Promise.all([
        context.queryClient.ensureQueryData(spacesQueryOptions),
        context.queryClient.ensureQueryData(spaceNodesQueryOptions(params.spaceId)),
      ]);
      if (spaces.spaces.every((space) => space.id !== params.spaceId)) throw notFound();
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
