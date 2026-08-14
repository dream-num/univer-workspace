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
import { useI18n } from "../shared/i18n";
import { parseWorktreeDashboardSearch } from "../features/worktrees/worktree-review-search";
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
  const { worktree, unit, view = "agent" } = Route.useSearch();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <WorkspaceLayout
      selectedView="worktrees"
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchTasks")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      <WorktreeDashboard
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
                  worktree: selection.worktreeId,
                  unit: selection.unitId,
                  view: selection.view,
                }
              : {},
          });
        }}
      />
    </WorkspaceLayout>
  );
}
