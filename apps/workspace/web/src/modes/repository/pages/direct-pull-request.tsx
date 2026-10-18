import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import type { WorktreesPageProps } from "../../page.types";
import { worktreeQueryOptions } from "../../../features/worktrees/worktrees.queries";
import { spacesQueryOptions } from "../../../features/spaces";
import { useI18n } from "../../../shared/i18n";
import { WorkspaceLayout } from "../../workspace-layout";
import { RepositoryQueryState } from "../repository-controls";
import { repositoryWorktreeSearch } from "../repository-worktree-link";

/** Resolve an explicit ID independently of list pagination before entering its repository. */
export function RepositoryDirectPullRequest(
  props: WorktreesPageProps & { readonly worktree: string },
) {
  const { t } = useI18n();
  const task = useQuery(worktreeQueryOptions(props.worktree));
  const spaces = useQuery(spacesQueryOptions);
  const personalId = spaces.data?.spaces.find(
    (space) => space.type === "personal" && space.accessRole === "owner",
  )?.id;
  const target = task.data ? repositoryWorktreeSearch(task.data.worktree, personalId) : undefined;
  if (target?.spaceId) return <Navigate to="/worktrees" search={{ ...props, ...target }} replace />;
  return (
    <WorkspaceLayout repositoryView="worktrees" headerTitle={t("repositoryPullRequests")}>
      <div className="repository-global-scroll">
        <div className="repository-directory">
          <RepositoryQueryState
            pending={task.isPending || spaces.isPending}
            failed={task.isError || spaces.isError}
            retry={() => {
              void task.refetch();
              void spaces.refetch();
            }}
          >
            <div className="repository-empty">
              <h1 className="text-xl font-semibold">
                {t(
                  task.data && !task.data.worktree.capabilities.review
                    ? "dashboardSummaryOnly"
                    : "workbenchSelectionUnavailable",
                )}
              </h1>
            </div>
          </RepositoryQueryState>
          <Link
            to="/worktrees"
            search={{
              ...(props.scope ? { scope: props.scope } : {}),
              ...(props.q ? { q: props.q } : {}),
              ...(props.kind ? { kind: props.kind } : {}),
              ...(props.teamSpaceId ? { teamSpaceId: props.teamSpaceId } : {}),
            }}
            className="text-sm text-primary hover:underline"
          >
            {t("repositoryAllPullRequests")}
          </Link>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
