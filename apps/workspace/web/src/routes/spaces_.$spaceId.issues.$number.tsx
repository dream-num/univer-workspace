import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { ResourceUnavailablePage } from "../features/nodes";
import { ensureSpace, spaceQueryOptions } from "../features/spaces";
import { useModeDefinition } from "../modes/registry";

export const Route = createFileRoute("/spaces_/$spaceId/issues/$number")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    const space = await ensureSpace(context.queryClient, params.spaceId);
    if (
      !/^[1-9]\d{0,9}$/.test(params.number) ||
      space.type !== "team"
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
  const spaces = useQuery(spaceQueryOptions(spaceId));
  const space = spaces.data;
  return (
    <pages.issueDetail spaceId={spaceId} number={Number(number)} canCreate={space?.capabilities.createIssue ?? false} />
  );
}
