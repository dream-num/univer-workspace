import type { FolderPageProps } from "../../page.types";
import { useQuery } from "@tanstack/react-query";
import { NodeBrowser, nodeChildrenQueryOptions } from "../../../features/nodes";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "../../../routes/-workspace-layout";
import { useI18n } from "../../../shared/i18n";

export function WikiFolderPage({ detail, searchQuery, onSearchChange }: FolderPageProps) {
  const { node } = detail;
  const children = useQuery({
    ...nodeChildrenQueryOptions(node.id),
    enabled: node.capabilities.browseChildren,
  });
  const { t } = useI18n();
  const selectedNodePath = [...detail.breadcrumbs.map((item) => item.id), node.id];
  return (
    <WorkspaceLayout
      selectedSpaceId={detail.space.id}
      selectedNodeId={node.id}
      selectedNodePath={selectedNodePath}
      contentMode="default"
      headerTitle={node.name}
      headerContent={
        <WorkspaceHeaderSearch placeholder={t("searchNodes")} value={searchQuery} onChange={onSearchChange} />
      }
    >
      {children.data ? (
        <NodeBrowser page={children.data} searchQuery={searchQuery} onClearSearch={() => onSearchChange("")} />
      ) : null}
    </WorkspaceLayout>
  );
}
