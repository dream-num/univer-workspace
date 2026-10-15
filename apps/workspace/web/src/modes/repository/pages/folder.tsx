import type { FolderPageProps } from "../../page.types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NodeBrowser, nodeChildrenQueryOptions } from "../../../features/nodes";
import { RepositoryTabs, spaceDisplayName } from "../../../features/spaces";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";
import { useI18n } from "../../../shared/i18n";

export function RepositoryFolderPage({ detail, username }: FolderPageProps) {
  const { node } = detail;
  const children = useQuery({
    ...nodeChildrenQueryOptions(node.id),
    enabled: node.capabilities.browseChildren,
  });
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const selectedNodePath = [...detail.breadcrumbs.map((item) => item.id), node.id];
  const repositoryBreadcrumbs = detail.breadcrumbs.map((item) => ({ label: item.name, nodeId: item.id }));
  return (
    <WorkspaceLayout
      selectedSpaceId={detail.space.id}
      repositoryTab="files"
      repositoryBreadcrumbs={repositoryBreadcrumbs}
      selectedNodeId={node.id}
      selectedNodePath={selectedNodePath}
      contentMode="default"
      headerTitle={node.name}
    >
      {children.data ? (
        <>
          <RepositoryTabs spaceId={detail.space.id} active="files" />
          <div className="min-h-0 flex-1 overflow-y-auto bg-background">
            <div className="mx-auto max-w-7xl px-8 py-6 max-[720px]:px-4 max-[720px]:py-4">
              <NodeBrowser
                page={children.data}
                searchQuery={searchQuery}
                showParentRow
                spaceName={spaceDisplayName(detail.space, t, username)}
                onSearchChange={setSearchQuery}
                searchPlaceholder={t("repositoryGoToFile")}
                compact
              />
            </div>
          </div>
        </>
      ) : null}
    </WorkspaceLayout>
  );
}
