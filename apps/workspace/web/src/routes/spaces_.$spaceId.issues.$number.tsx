import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { IssueDetail } from "../features/issues";
import { ResourceUnavailablePage } from "../features/nodes";
import { spacesQueryOptions } from "../features/spaces";
import { IssueRouteLayout } from "./-issue-layout";

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
  const { spaceId, number } = Route.useParams();
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  return (
    <IssueRouteLayout spaceId={spaceId} crumb={`#${number}`}>
      <IssueDetail
        spaceId={spaceId}
        number={Number(number)}
        canCreate={space?.capabilities.createIssue ?? false}
      />
    </IssueRouteLayout>
  );
}
