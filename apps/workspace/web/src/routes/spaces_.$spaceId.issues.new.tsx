import { useQuery } from "@tanstack/react-query";
import { Navigate, createFileRoute, notFound } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { IssueNewForm } from "../features/issues";
import { ResourceUnavailablePage } from "../features/nodes";
import { spacesQueryOptions } from "../features/spaces";
import { useI18n } from "../shared/i18n";
import { IssueRouteLayout } from "./-issue-layout";

export const Route = createFileRoute("/spaces_/$spaceId/issues/new")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(typeof search["node"] === "string" && search["node"] ? { node: search["node"] } : {}),
  }),
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    const spaces = await context.queryClient.ensureQueryData(spacesQueryOptions);
    if (spaces.spaces.every((space) => space.id !== params.spaceId || space.type !== "team")) {
      throw notFound();
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: NewIssuePage,
});

function NewIssuePage() {
  const { spaceId } = Route.useParams();
  const { node } = Route.useSearch();
  const { t } = useI18n();
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  if (space && !space.capabilities.createIssue) {
    return <Navigate to="/spaces/$spaceId/issues" params={{ spaceId }} search={{}} replace />;
  }
  return (
    <IssueRouteLayout spaceId={spaceId} crumb={t("issueNew")}>
      <IssueNewForm spaceId={spaceId} canTriage={space?.capabilities.triageIssues ?? false} initialNodeId={node} />
    </IssueRouteLayout>
  );
}
