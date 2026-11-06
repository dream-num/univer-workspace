import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { IssueLabelsManager } from "../features/issues";
import { ResourceUnavailablePage } from "../features/nodes";
import { ensureSpace, spaceQueryOptions } from "../features/spaces";
import { useI18n } from "../shared/i18n";
import { IssueRouteLayout } from "./-issue-layout";

export const Route = createFileRoute("/spaces_/$spaceId/issues/labels")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    const space = await ensureSpace(context.queryClient, params.spaceId);
    if (space.type !== "team") {
      throw notFound();
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: IssueLabelsPage,
});

function IssueLabelsPage() {
  const { spaceId } = Route.useParams();
  const { t } = useI18n();
  const spaces = useQuery(spaceQueryOptions(spaceId));
  const space = spaces.data;
  return (
    <IssueRouteLayout spaceId={spaceId} crumb={t("issueLabels")}>
      <IssueLabelsManager spaceId={spaceId} canManage={space?.capabilities.manageIssueLabels ?? false} />
    </IssueRouteLayout>
  );
}
