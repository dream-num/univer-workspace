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
import { Empty } from "../shared/ui";
import { WorkspaceLayout } from "./-workspace-layout";

export const Route = createFileRoute("/apps")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(typeof search.node === "string" && search.node ? { node: search.node } : {}),
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
  const { node: selectedNodeId } = Route.useSearch();
  const [htmlActionsContainer, setHtmlActionsContainer] = useState<HTMLSpanElement | null>(null);
  const items = query.data?.items ?? [];
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
      {items.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Empty title={t("appsEmpty")} description={t("appsEmptyDescription")} />
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
