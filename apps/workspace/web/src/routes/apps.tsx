import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { anonymousUser, requireAuthenticatedSession, sessionQueryOptions } from "../features/auth";
import { selectedHtmlView } from "../features/html-views/app-tree";
import { BlobPreview } from "../features/blobs";
import { ResourceActions, ResourceTitle, nodeQueryOptions } from "../features/nodes";
import { resourceOpenQueryOptions } from "../features/resources";
import { htmlViewsQueryOptions } from "../features/views/html-views.queries";
import { useI18n } from "../shared/i18n";
import { Button, Empty } from "../shared/ui";
import { WorkspaceLayout } from "./-workspace-layout";

export const Route = createFileRoute("/apps")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(typeof search.node === "string" && search.node ? { node: search.node } : {}),
    ...(typeof search.spaceId === "string" && search.spaceId ? { spaceId: search.spaceId } : {}),
  }),
  loader: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await context.queryClient.ensureQueryData(htmlViewsQueryOptions);
  },
  component: AppsPage,
});

function AppsPage() {
  const { t } = useI18n();
  const query = useQuery(htmlViewsQueryOptions);
  const session = useQuery(sessionQueryOptions);
  const { node: selectedNodeId, spaceId } = Route.useSearch();
  const [htmlActionsContainer, setHtmlActionsContainer] = useState<HTMLSpanElement | null>(null);
  const items = (query.data?.items ?? []).filter(
    (item) => spaceId === undefined || item.location.space.id === spaceId,
  );
  const selected = items.length === 0 ? undefined : selectedHtmlView(items, selectedNodeId);
  const nodeQuery = useQuery({
    ...nodeQueryOptions(selected?.node.id ?? ""),
    enabled: selected !== undefined,
  });
  const resourceQuery = useQuery({
    ...resourceOpenQueryOptions(selected?.resource.id ?? ""),
    enabled: selected !== undefined,
  });
  const node = nodeQuery.data?.node;
  const resource = resourceQuery.data?.resource;
  const user = session.data?.authenticated ? session.data.user : anonymousUser;

  return (
    <WorkspaceLayout
      {...(spaceId ? { selectedSpaceId: spaceId } : {})}
      selectedView="apps"
      contentMode={selected ? "editor" : "default"}
      headerTitle={
        node?.resource && session.data ? (
          <ResourceTitle
            key={node.id}
            node={node}
            resourceId={node.resource.id}
            authenticated={session.data.authenticated}
          />
        ) : undefined
      }
      headerActions={
        node?.resource && resource && session.data ? (
          <ResourceActions
            key={node.id}
            node={node}
            resource={resource}
            authenticated={session.data.authenticated}
            currentUserId={user.id}
            collaborators={[]}
            htmlActionsRef={setHtmlActionsContainer}
          />
        ) : undefined
      }
    >
      {query.isPending ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Empty title={t("repositoryPageLoading")} />
        </div>
      ) : query.isError ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Empty title={t("repositoryPageError")}>
            <Button variant="secondary" onClick={() => void query.refetch()}>{t("repositoryPageRetry")}</Button>
          </Empty>
        </div>
      ) : items.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Empty
            title={t("appsEmpty")}
            description={
              <>
                {t("appsEmptyDescription")}
                <br />
                {t("appsEmptyHint")}
              </>
            }
          />
        </div>
      ) : resourceQuery.isPending ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Empty title={t("repositoryPageLoading")} />
        </div>
      ) : resourceQuery.isError ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Empty title={t("repositoryPageError")}>
            <Button variant="secondary" onClick={() => void resourceQuery.refetch()}>{t("repositoryPageRetry")}</Button>
          </Empty>
        </div>
      ) : resource?.kind === "blob" ? (
        <section
          key={resource.id}
          className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
        >
          <BlobPreview resource={resource} actionsContainer={htmlActionsContainer} />
        </section>
      ) : null}
    </WorkspaceLayout>
  );
}
