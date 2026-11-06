import type { FolderPageProps } from "../../page.types";
import { useQuery } from "@tanstack/react-query";
import { nodeChildrenQueryOptions } from "../../../features/nodes";
import { spaceDisplayName } from "../space-name";
import { WorkspaceLayout } from "../../workspace-layout";
import { useI18n } from "../../../shared/i18n";
import { usePendingChanges, useRepositoryActivity } from "../data";
import { RepositoryFileTable } from "../code/repository-file-table";

export function RepositoryFolderPage({
  detail,
  username,
  searchQuery,
  onSearchChange,
}: FolderPageProps) {
  const { node } = detail;
  const children = useQuery({
    ...nodeChildrenQueryOptions(node.id),
    enabled: node.capabilities.browseChildren,
  });
  const { t } = useI18n();
  const pending = usePendingChanges(detail.space);
  const activity = useRepositoryActivity(detail.space);
  return (
    <WorkspaceLayout
      selectedSpaceId={detail.space.id}
      repositoryTab="files"
      repositoryBreadcrumbs={detail.breadcrumbs.map((item) => ({
        label: item.name,
        nodeId: item.id,
      }))}
      selectedNodeId={node.id}
      selectedNodePath={[...detail.breadcrumbs.map((item) => item.id), node.id]}
      contentMode="default"
      headerTitle={node.name}
    >
      {children.data ? (
        <div className="rd-folder-body">
          <RepositoryFileTable
            page={children.data}
            searchQuery={searchQuery}
            spaceName={spaceDisplayName(detail.space, t, username)}
            onSearchChange={onSearchChange}
            pending={pending.status === "success" ? pending.data : undefined}
            latest={activity.status === "success" ? activity.data.events[0] : undefined}
          />
          {pending.status === "error" ? (
            <p className="rd-data-note" role="status">
              {t("repositoryPendingFailed")}
            </p>
          ) : null}
        </div>
      ) : null}
    </WorkspaceLayout>
  );
}
