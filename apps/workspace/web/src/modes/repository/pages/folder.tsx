import { Route } from "../../../routes/nodes.$nodeId";
import { useQuery } from "@tanstack/react-query";

import { useCallback, useState } from "react";
import type { IMember } from "@univerjs/protocol";
import { NodeBrowser, ResourceActions, nodeChildrenQueryOptions, nodeQueryOptions } from "../../../features/nodes";
import { anonymousUser, sessionQueryOptions } from "../../../features/auth";
import { resourceOpenQueryOptions } from "../../../features/resources";
import { RepositoryTabs, spaceDisplayName } from "../../../features/spaces";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "../../../routes/-workspace-layout";
import { ResourceEditor } from "../../../features/editor";
import { BlobPreview } from "../../../features/blobs";

import { useI18n } from "../../../shared/i18n";
import { useTheme } from "../../../shared/theme";

export function RepositoryFolderPage() {
  const { nodeId } = Route.useParams();
  const { view } = Route.useSearch();
  const query = useQuery(nodeQueryOptions(nodeId));
  const children = useQuery({
    ...nodeChildrenQueryOptions(nodeId),
    enabled: query.data?.node.resource === null && query.data.node.capabilities.browseChildren,
  });
  const resourceId = query.data?.node.resource?.id;
  const resourceQuery = useQuery({
    ...resourceOpenQueryOptions(resourceId ?? ""),
    enabled: resourceId !== undefined,
  });
  const session = useQuery(sessionQueryOptions);
  const { t } = useI18n();
  const { workspaceTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [htmlActionsContainer, setHtmlActionsContainer] = useState<HTMLSpanElement | null>(null);
  const [collaboration, setCollaboration] = useState<{
    nodeId: string;
    members: readonly IMember[];
  }>({ nodeId, members: [] });
  // The shell survives navigation; presence belongs only to the current Node.
  if (collaboration.nodeId !== nodeId) {
    setCollaboration({ nodeId, members: [] });
  }
  const onCollaboratorsChange = useCallback(
    (members: readonly IMember[]) => {
      setCollaboration((current) => (current.nodeId === nodeId ? { nodeId, members } : current));
    },
    [nodeId],
  );

  if (!query.data || !session.data) return null;
  const node = query.data.node;
  const resource = resourceQuery.data?.resource;
  const user = session.data.authenticated ? session.data.user : anonymousUser;
  const selectedNodePath = [...query.data.breadcrumbs.map((item) => item.id), node.id];
  const repository = workspaceTheme === "repository";
  // `/nodes/{id}` already returns the full ancestor chain, including this Node;
  // the shell drops a trailing crumb that repeats the page title.
  const repositoryBreadcrumbs = query.data.breadcrumbs.map((item) => ({
    label: item.name,
    nodeId: item.id,
  }));
  const isEditing =
    session.data.authenticated && resource?.kind === "univer" && resource.editorMode === "edit";

  // Keep one layout for folders, Blobs and Univer documents. Only the resource
  // content and its header controls reset when their identity changes.
  return (
    <WorkspaceLayout
      immersive={node.resource !== null && view === "immersive"}
      selectedSpaceId={query.data.space.id}
      {...(node.resource === null
        ? { repositoryTab: "files" as const, repositoryBreadcrumbs }
        : { repositoryBreadcrumbs })}
      selectedNodeId={node.id}
      selectedNodePath={selectedNodePath}
      contentMode={node.resource ? "editor" : "default"}
      headerTitle={node.name}
      headerContent={
        node.resource || repository ? undefined : (
          <WorkspaceHeaderSearch
            placeholder={t("searchNodes")}
            value={searchQuery}
            onChange={setSearchQuery}
          />
        )
      }
      headerActions={
        node.resource && resource ? (
          <ResourceActions
            key={node.id}
            node={node}
            resource={resource}
            authenticated={session.data.authenticated}
            currentUserId={user.id}
            collaborators={collaboration.members}
            htmlActionsRef={setHtmlActionsContainer}
          />
        ) : undefined
      }
    >
      {node.resource ? (
        resource ? (
          <section
            key={resource.id}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
          >
            {resource.kind === "blob" ? (
              <BlobPreview
                resource={resource}
                immersive={view === "immersive"}
                actionsContainer={htmlActionsContainer}
              />
            ) : (
              <ResourceEditor
                unitId={resource.unitId}
                unitType={resource.unitType}
                user={user}
                readOnly={!isEditing}
                onCollaboratorsChange={onCollaboratorsChange}
              />
            )}
          </section>
        ) : null
      ) : children.data ? (
        repository ? (
          <>
            <RepositoryTabs spaceId={query.data.space.id} active="files" />
            <div className="min-h-0 flex-1 overflow-y-auto bg-background">
              <div className="mx-auto max-w-7xl px-8 py-6 max-[720px]:px-4 max-[720px]:py-4">
                <NodeBrowser
                  page={children.data}
                  searchQuery={searchQuery}
                  showParentRow
                  spaceName={spaceDisplayName(
                    query.data.space,
                    t,
                    session.data.authenticated ? session.data.user.username : undefined,
                  )}
                  onSearchChange={setSearchQuery}
                  searchPlaceholder={t("repositoryGoToFile")}
                  compact
                />
              </div>
            </div>
          </>
        ) : (
          <NodeBrowser
            page={children.data}
            searchQuery={searchQuery}
            onClearSearch={() => setSearchQuery("")}
          />
        )
      ) : null}
    </WorkspaceLayout>
  );
}
