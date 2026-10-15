import type { WorktreesPageProps } from "../../page.types";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { WorktreeDashboard } from "../../../features/worktrees";
import { useI18n } from "../../../shared/i18n";
import { DEFAULT_WORKTREE_REVIEW_VIEW } from "../../../features/worktrees/worktree-review-search";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "../../../routes/-workspace-layout";

export function WikiWorktreesPage(props: WorktreesPageProps) {
  const { t } = useI18n();
  const { spaceId, worktree, unit, view = DEFAULT_WORKTREE_REVIEW_VIEW } = props;
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <WorkspaceLayout
      {...(spaceId ? { selectedSpaceId: spaceId } : {})}
      selectedView="worktrees"
      headerContent={
        <WorkspaceHeaderSearch placeholder={t("searchTasks")} value={searchQuery} onChange={setSearchQuery} />
      }
    >
      {
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
      }
    </WorkspaceLayout>
  );
}
