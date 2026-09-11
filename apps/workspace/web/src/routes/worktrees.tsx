import {
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { worktreeListQueryOptions } from "../features/worktrees";
import { requireAuthenticatedSession } from "../features/auth";
import { useI18n } from "../shared/i18n";
import { Spinner } from "../shared/ui";
import {
  DEFAULT_WORKTREE_REVIEW_VIEW,
  parseWorktreeDashboardSearch,
} from "../features/worktrees/worktree-review-search";
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";

const WorktreeDashboard = lazy(() =>
  import("../features/worktrees/worktree-dashboard").then((m) => ({
    default: m.WorktreeDashboard,
  }))
);

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
  const {
    worktree,
    unit,
    view = DEFAULT_WORKTREE_REVIEW_VIEW,
  } = Route.useSearch();
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
      <Suspense
        fallback={
          <div className="grid h-full place-items-center">
            <Spinner className="size-6 text-brand-600" />
          </div>
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
      </Suspense>
    </WorkspaceLayout>
  );
}
