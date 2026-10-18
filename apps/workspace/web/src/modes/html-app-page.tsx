import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { anonymousUser, sessionQueryOptions } from "../features/auth";
import { selectedHtmlView } from "../features/html-views/app-tree";
import { BlobPreview } from "../features/blobs";
import { ResourceActions, ResourceTitle, nodeQueryOptions } from "../features/nodes";
import { resourceOpenQueryOptions } from "../features/resources";
import { htmlViewsQueryOptions } from "../features/views/html-views.queries";
import type { AppsPageProps } from "./page.types";
import { useI18n } from "../shared/i18n";
import { useUiMode } from "../shared/ui-mode";
import { Button, Empty } from "../shared/ui";
import { WorkspaceLayout } from "./workspace-layout";

/** Existing embedded viewer, shared by both modes. Directory browsing never mounts it. */
export function HtmlAppPage({ node: selectedNodeId, spaceId, q }: AppsPageProps) {
  const { t } = useI18n();
  const { mode } = useUiMode();
  const session = useQuery(sessionQueryOptions);
  const [htmlActionsContainer, setHtmlActionsContainer] = useState<HTMLSpanElement | null>(null);
  const query = useQuery({
    ...htmlViewsQueryOptions(spaceId),
    enabled: selectedNodeId === undefined,
  });
  const items = (query.data?.items ?? []).filter(
    (item) => !spaceId || item.location.space.id === spaceId,
  );
  const nodeId = selectedNodeId ?? selectedHtmlView(items, undefined)?.node.id;
  const nodeQuery = useQuery({ ...nodeQueryOptions(nodeId ?? ""), enabled: nodeId !== undefined });
  const node = nodeQuery.data?.node;
  const resourceQuery = useQuery({
    ...resourceOpenQueryOptions(node?.resource?.id ?? ""),
    enabled: node?.resource !== null && node?.resource !== undefined,
  });
  const resource = resourceQuery.data?.resource;
  const user = session.data?.authenticated ? session.data.user : anonymousUser;
  const failed =
    (selectedNodeId === undefined && query.isError) ||
    (nodeId !== undefined && nodeQuery.isError) ||
    resourceQuery.isError;
  const empty = selectedNodeId === undefined && query.isSuccess && items.length === 0;
  return (
    <WorkspaceLayout
      {...(spaceId ? { selectedSpaceId: spaceId } : {})}
      selectedView="apps"
      contentMode={nodeId ? "editor" : "default"}
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
      {mode === "repository" ? (
        <div className="repository-chrome shrink-0 border-b border-border px-4 py-3">
          <Link
            to="/apps"
            search={{ ...(spaceId ? { spaceId } : {}), ...(q ? { q } : {}) }}
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("pages")}
          </Link>
        </div>
      ) : null}
      {failed ? (
        <Empty title={t("repositoryPageError")}>
          <Button
            variant="secondary"
            onClick={() => {
              if (!selectedNodeId) void query.refetch();
              if (nodeId) void nodeQuery.refetch();
              if (node?.resource) void resourceQuery.refetch();
            }}
          >
            {t("repositoryPageRetry")}
          </Button>
        </Empty>
      ) : empty ? (
        <Empty title={t("appsEmpty")} description={t("appsEmptyHint")} />
      ) : resource?.kind === "blob" ? (
        <section
          key={resource.id}
          className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
        >
          <BlobPreview resource={resource} actionsContainer={htmlActionsContainer} />
        </section>
      ) : nodeId && nodeQuery.isSuccess && (!node?.resource || resourceQuery.isSuccess) ? (
        <Empty title={t("repositoryPageError")} />
      ) : (
        <div role="status" className="grid flex-1 place-items-center">
          <Empty title={t("repositoryPageLoading")} />
        </div>
      )}
    </WorkspaceLayout>
  );
}
