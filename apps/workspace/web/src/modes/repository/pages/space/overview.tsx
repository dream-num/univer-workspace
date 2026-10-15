import { cn } from "../../../../shared/utils/cn";
import type { SpaceView, RepositoryPage, RepositoryApp, RepositoryBlob, RepositoryView, Worktree } from "./types";
import { FilesView } from "./files-view";
import { AppsView } from "./apps-view";
import { PullRequestsView } from "./pull-requests-view";

export function RepositoryOverview({
  spaceId,
  space,
  spaceName,
  page,
  apps,
  selectedApp,
  resource,
  loading,
  error,
  onRetry,
  onSelectApp,
  view,
  worktrees,
  worktreesLoading,
  worktreesError,
  onRetryWorktrees,
  onOpenWorktrees,
}: {
  readonly spaceId: string;
  readonly space: SpaceView | undefined;
  readonly spaceName: string | undefined;
  readonly page: RepositoryPage;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly resource: RepositoryBlob | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly onSelectApp: (nodeId: string) => void;
  readonly view: RepositoryView;
  readonly worktrees: readonly Worktree[];
  readonly worktreesLoading: boolean;
  readonly worktreesError: boolean;
  readonly onRetryWorktrees: () => void;
  readonly onOpenWorktrees: () => void;
}) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto bg-background",
        view === "prs" && "repository-chrome repository-pull-requests",
        view === "apps" && "repository-pages",
      )}
    >
      <div
        className={cn(
          "mx-auto px-6 py-6 max-[720px]:px-4 max-[720px]:py-4",
          view === "apps"
            ? "w-full max-w-[1012px] px-4 py-8 max-[720px]:py-8"
            : "max-w-7xl px-8 max-[720px]:px-4",
        )}
      >
        {view === "files" ? (
          <FilesView
            spaceId={spaceId}
            space={space}
            spaceName={spaceName}
            page={page}
            apps={apps}
            selectedApp={selectedApp}
            resource={resource}
            loading={loading}
            error={error}
            onRetry={onRetry}
            onSelectApp={onSelectApp}
          />
        ) : view === "apps" ? (
          <AppsView
            spaceId={spaceId}
            apps={apps}
            selectedApp={selectedApp}
            onSelectApp={onSelectApp}
          />
        ) : (
          <PullRequestsView
            spaceId={spaceId}
            worktrees={worktrees}
            loading={worktreesLoading}
            error={worktreesError}
            onRetry={onRetryWorktrees}
            onOpenWorktrees={onOpenWorktrees}
          />
        )}
      </div>
    </div>
  );
}
