import { RepositoryPullRequestLayout } from "../repository-pull-request-layout";
import type { WorktreesPageProps } from "../../page.types";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WorktreeDashboard, worktreeQueryOptions, worktreeBelongsToSpace } from "../../../features/worktrees";
import { spacesQueryOptions } from "../../../features/spaces";
import { RepositoryTabs } from "../repository-tabs";
import { WorktreeReviewPanel } from "../../../features/worktrees/worktree-review-panel";
import { Button, Empty, Skeleton } from "../../../shared/ui";
import { useI18n } from "../../../shared/i18n";
import {
  DEFAULT_WORKTREE_REVIEW_VIEW,
  type WorktreeReviewView,
} from "../../../features/worktrees/worktree-review-search";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "../../workspace-layout";

export function RepositoryWorktreesPage(props: WorktreesPageProps) {
  const { t } = useI18n();
  const { spaceId, worktree, unit, section = unit ? "files" : "overview", view = DEFAULT_WORKTREE_REVIEW_VIEW } = props;
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  // A space-scoped review stays inside the repository shell, opened from the
  // PRs tab; the global workbench keeps its own navigation.
  const repository = spaceId !== undefined;

  return (
    <WorkspaceLayout
      {...(spaceId ? { selectedSpaceId: spaceId } : {})}
      {...(repository ? { repositoryTab: "prs" as const } : { selectedView: "worktrees" as const })}
      headerContent={
        repository && worktree ? undefined : (
          <WorkspaceHeaderSearch placeholder={t("searchTasks")} value={searchQuery} onChange={setSearchQuery} />
        )
      }
    >
      {repository ? <RepositoryTabs spaceId={spaceId} active="prs" /> : null}
      {repository && worktree ? (
        <RepositoryPullRequestPage
          spaceId={spaceId}
          worktreeId={worktree}
          unitId={unit}
          view={view}
          section={section}
          onViewChange={(nextView) => {
            void navigate({
              to: "/worktrees",
              search: {
                spaceId,
                worktree,
                ...(unit ? { unit } : {}),
                section: "files",
                view: nextView,
              },
            });
          }}
        />
      ) : (
        <WorktreeDashboard
          {...(spaceId ? { spaceId } : {})}
          searchQuery={searchQuery}
          {...(worktree === undefined ? {} : { selectedWorktreeId: worktree })}
          {...(unit === undefined ? {} : { selectedUnitId: unit })}
          selectedView={view}
          onSelectionChange={(selection) => {
            void navigate({
              to: "/worktrees",
              search: selection
                ? {
                    ...(spaceId ? { spaceId } : {}),
                    worktree: selection.worktreeId,
                    unit: selection.unitId,
                    view: selection.view,
                  }
                : spaceId
                  ? { spaceId }
                  : {},
            });
          }}
        />
      )}
    </WorkspaceLayout>
  );
}

function RepositoryPullRequestPage({
  spaceId,
  worktreeId,
  unitId,
  view,
  section,
  onViewChange,
}: {
  readonly spaceId: string;
  readonly worktreeId: string;
  readonly unitId: string | undefined;
  readonly view: WorktreeReviewView;
  readonly section: "overview" | "files";
  readonly onViewChange: (view: WorktreeReviewView) => void;
}) {
  const { t } = useI18n();
  const query = useQuery(worktreeQueryOptions(worktreeId));
  const spaces = useQuery(spacesQueryOptions);
  if (query.isPending || spaces.isPending)
    return (
      <div role="status" aria-label={t("onboardingLoading")} className="grid gap-4 p-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-60" />
      </div>
    );
  if (query.isError || spaces.isError)
    return (
      <Empty title={t("repositoryPullRequestsFailed")}>
        <Button
          variant="secondary"
          onClick={() => {
            void query.refetch();
            void spaces.refetch();
          }}
        >
          {t("repositoryPageRetry")}
        </Button>
      </Empty>
    );
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  if (!space || !worktreeBelongsToSpace(query.data.worktree, space))
    return (
      <Empty title={t("workbenchSelectionUnavailable")} description={t("workbenchSelectionUnavailableDescription")} />
    );
  return (
    <WorktreeReviewPanel
      key={worktreeId}
      worktree={query.data.worktree}
      {...(unitId ? { selectedUnitId: unitId } : {})}
      selectedView={view}
      onSelectedViewChange={onViewChange}
      layout={({ review, actions }) => (
        <RepositoryPullRequestLayout
          worktree={query.data.worktree}
          presentation={{ spaceId, section }}
          selectedUnitId={unitId || query.data.worktree.units[0]?.unitId}
          selectedView={view}
          review={review}
          actions={actions}
        />
      )}
    />
  );
}
