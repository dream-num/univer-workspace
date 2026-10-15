import type { SpacePageProps } from "../../../page.types";

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { NodeBrowser, spaceNodesQueryOptions } from "../../../../features/nodes";
import { sessionQueryOptions } from "../../../../features/auth";
import { htmlViewsQueryOptions } from "../../../../features/views/html-views.queries";
import { resourceOpenQueryOptions } from "../../../../features/resources";
import { RepositoryTabs, spaceDisplayName, spacesQueryOptions } from "../../../../features/spaces";
import { WorkspaceLayout } from "../../../../routes/-workspace-layout";
import { useI18n } from "../../../../shared/i18n";
import { worktreeBelongsToSpace, worktreeListQueryOptions } from "../../../../features/worktrees";

import { RepositoryOverview } from "./overview";

export function RepositorySpacePage({ spaceId, view }: SpacePageProps) {
  const repositoryView = view ?? "files";
  const query = useQuery(spaceNodesQueryOptions(spaceId));
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery({
    ...spacesQueryOptions,
    enabled: session.data?.authenticated === true,
  });
  const navigate = useNavigate();
  const { t } = useI18n();
  const [landingNodeId, setLandingNodeId] = useState<string | undefined>(() => {
    try {
      return window.localStorage.getItem(`univer-workspace-landing-app:${spaceId}`) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const space = session.data?.authenticated ? spaces.data?.spaces.find((item) => item.id === spaceId) : undefined;
  const spaceName = spaceDisplayName(space, t, session.data?.authenticated ? session.data.user.username : undefined);
  const repositoryTheme = space !== undefined;
  const apps = useQuery({
    ...htmlViewsQueryOptions(spaceId),
    enabled: repositoryTheme,
  });
  const worktrees = useQuery({
    ...worktreeListQueryOptions("active"),
    enabled: repositoryTheme,
  });
  const processedWorktrees = useQuery({
    ...worktreeListQueryOptions("processed"),
    enabled: repositoryTheme,
  });
  const spaceApps = (apps.data?.items ?? []).filter((item) => item.location.space.id === spaceId);
  const selectedApp = spaceApps.find((item) => item.node.id === landingNodeId) ?? spaceApps[0];
  const spaceWorktrees = [...(worktrees.data?.items ?? []), ...(processedWorktrees.data?.items ?? [])].filter(
    (item) => space !== undefined && worktreeBelongsToSpace(item, space),
  );
  useEffect(() => {
    if (!landingNodeId || !apps.isSuccess || spaceApps.some((item) => item.node.id === landingNodeId)) return;
    setLandingNodeId(undefined);
    try {
      window.localStorage.removeItem(`univer-workspace-landing-app:${spaceId}`);
    } catch {
      // Local storage may be unavailable.
    }
  }, [apps.isSuccess, landingNodeId, spaceApps, spaceId]);
  const selectedResource = useQuery({
    ...resourceOpenQueryOptions(selectedApp?.resource.id ?? ""),
    enabled: selectedApp !== undefined,
  });
  const retryRepositoryPage = () => {
    void apps.refetch();
    if (selectedApp) void selectedResource.refetch();
  };
  const setLandingApp = (nodeId: string) => {
    setLandingNodeId(nodeId);
    try {
      window.localStorage.setItem(`univer-workspace-landing-app:${spaceId}`, nodeId);
    } catch {
      // The current selection remains usable without browser storage.
    }
  };
  if (!query.data) return null;
  return (
    <WorkspaceLayout selectedSpaceId={spaceId} {...(repositoryTheme ? { repositoryTab: repositoryView } : {})}>
      {repositoryTheme ? (
        <>
          <RepositoryTabs spaceId={spaceId} active={repositoryView} />
          <RepositoryOverview
            spaceId={spaceId}
            space={space}
            spaceName={spaceName}
            page={query.data}
            apps={spaceApps}
            selectedApp={selectedApp}
            resource={selectedResource.data?.resource.kind === "blob" ? selectedResource.data.resource : undefined}
            loading={apps.isPending || (selectedApp !== undefined && selectedResource.isPending)}
            error={apps.isError || selectedResource.isError}
            onRetry={retryRepositoryPage}
            onSelectApp={setLandingApp}
            view={repositoryView}
            worktrees={spaceWorktrees}
            worktreesLoading={worktrees.isPending || processedWorktrees.isPending}
            worktreesError={worktrees.isError || processedWorktrees.isError}
            onRetryWorktrees={() => {
              void worktrees.refetch();
              void processedWorktrees.refetch();
            }}
            onOpenWorktrees={() => navigate({ to: "/worktrees", search: { spaceId } })}
          />
        </>
      ) : (
        <NodeBrowser
          page={query.data}
          canCreateAtRoot={false}
          actions={null}
        />
      )}
    </WorkspaceLayout>
  );
}
