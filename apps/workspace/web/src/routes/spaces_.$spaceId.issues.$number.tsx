import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { ResourceUnavailablePage } from "../features/nodes";
import { spacesQueryOptions } from "../features/spaces";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/spaces_/$spaceId/issues/$number")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    const spaces = await context.queryClient.ensureQueryData(spacesQueryOptions);
    if (
      !/^[1-9]\d{0,9}$/.test(params.number) ||
      spaces.spaces.every((space) => space.id !== params.spaceId || space.type !== "team")
    ) {
      throw notFound();
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: IssuePage,
});

function IssuePage() {
  const { pages } = useModeDefinition();
  const { spaceId, number } = Route.useParams();
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  return (
    <pages.issueDetail spaceId={spaceId} number={Number(number)} canCreate={space?.capabilities.createIssue ?? false} />
  );
}
