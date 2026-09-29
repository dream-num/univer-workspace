import {
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import {
  WorktreeDashboard,
  worktreeListQueryOptions,
} from "../features/worktrees";
import { requireAuthenticatedSession } from "../features/auth";
import { RepositoryTabs } from "../features/spaces";
import { useI18n } from "../shared/i18n";
import { useTheme } from "../shared/theme";
import {
  DEFAULT_WORKTREE_REVIEW_VIEW,
  parseWorktreeDashboardSearch,
} from "../features/worktrees/worktree-review-search";
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";

export const Route = createFileRoute("/worktrees")({
  validateSearch: parseWorktreeDashboardSearch,
  loader: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await Promise.all([
      context.queryClient.ensureQueryData(
        worktreeListQueryOptions("active")
      ),
      context.queryClient.ensureQueryData(
        worktreeListQueryOptions("processed")
      ),
    ]);
  },
  component: WorktreesPage,
});

function WorktreesPage() {
  const { t } = useI18n();
  const { workspaceTheme } = useTheme();
  const {
    spaceId,
    worktree,
    unit,
    view = DEFAULT_WORKTREE_REVIEW_VIEW,
  } = Route.useSearch();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  // A space-scoped review stays inside the repository shell, opened from the
  // PRs tab; the global workbench keeps its own navigation.
  const repository = workspaceTheme === "repository" && spaceId !== undefined;

  return (
    <WorkspaceLayout
      {...(spaceId ? { selectedSpaceId: spaceId } : {})}
      {...(repository ? { repositoryTab: "prs" as const } : { selectedView: "worktrees" as const })}
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchTasks")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      {repository ? <RepositoryTabs spaceId={spaceId} active="prs" /> : null}
      <WorktreeDashboard
        {...(spaceId ? { spaceId } : {})}
        searchQuery={searchQuery}
        {...(worktree === undefined
          ? {}
          : { selectedWorktreeId: worktree })}
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
              : spaceId ? { spaceId } : {},
          });
        }}
      />
    </WorkspaceLayout>
  );
}
