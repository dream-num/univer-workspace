import { FileDiff, GitPullRequest, Search, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { formatRelativeDate } from "../../../../shared/format-relative-date";
import { useI18n } from "../../../../shared/i18n";
import { isOpenWorktree } from "../../../../features/worktrees";
import { Button, Empty, Input, Skeleton } from "../../../../shared/ui";
import { RepositoryPrState } from "../../repository-pr-state";
import { cn } from "../../../../shared/utils/cn";
import type { Worktree } from "./types";

export function PullRequestsView({
  spaceId,
  worktrees,
  onOpenWorktrees,
  loading,
  error,
  onRetry,
}: {
  readonly spaceId: string;
  readonly worktrees: readonly Worktree[];
  readonly onOpenWorktrees: () => void;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
}) {
  const { language, t } = useI18n();
  const [stateFilter, setStateFilter] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const openCount = worktrees.filter((worktree) =>
    isOpenWorktree(worktree.state),
  ).length;
  const visible = worktrees.filter(
    (worktree) =>
      (stateFilter === "open"
        ? isOpenWorktree(worktree.state)
        : !isOpenWorktree(worktree.state)) &&
      [
        worktree.name,
        worktree.summary,
        worktree.creator.displayName,
        worktree.creator.username,
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch)),
  );
  return (
    <section className="repository-pull-requests grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-xl font-semibold">{t("repositoryAllPullRequests")}</h1>
        <Button size="sm" onClick={onOpenWorktrees}>
          {t("repositoryOpenWorkbench")}
        </Button>
      </div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-2 left-3 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          aria-label={t("repositorySearchPullRequests")}
          placeholder={t("repositorySearchPullRequests")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-8 rounded-md pl-9 pr-9 shadow-none"
        />
        {search ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("clearSearch")}
            className="absolute top-0 right-0"
            onClick={() => setSearch("")}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-background">
        <div className="flex flex-wrap items-center gap-4 border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-4 text-sm">
            <button
              type="button"
              onClick={() => setStateFilter("open")}
              aria-pressed={stateFilter === "open"}
              className={cn(
                "flex cursor-pointer items-center gap-2 hover:text-foreground",
                stateFilter === "open" ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {t("repositoryPullRequestsOpen")}
              <span className="rounded-full bg-[var(--color-repository-counter)] px-2 text-xs font-medium tabular-nums">
                {loading ? "…" : openCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStateFilter("closed")}
              aria-pressed={stateFilter === "closed"}
              className={cn(
                "flex cursor-pointer items-center gap-2 hover:text-foreground",
                stateFilter === "closed"
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {t("repositoryPullRequestsClosed")}
              <span className="rounded-full bg-[var(--color-repository-counter)] px-2 text-xs font-medium tabular-nums">
                {loading ? "…" : worktrees.length - openCount}
              </span>
            </button>
          </div>
        </div>
        {error ? (
          <Empty title={t("repositoryPullRequestsFailed")}>
            <Button variant="secondary" onClick={onRetry}>
              {t("repositoryPageRetry")}
            </Button>
          </Empty>
        ) : loading ? (
          <div role="status" aria-label={t("onboardingLoading")} className="grid gap-4 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : visible.length ? (
          <ul className="m-0 list-none p-0">
            {visible.map((worktree) => (
              <li key={worktree.id} className="relative border-b border-border last:border-b-0">
                <div className="flex items-start gap-2 px-4 py-3 hover:bg-accent/60">
                  <RepositoryPrState state={worktree.state} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/worktrees"
                      search={{ spaceId, worktree: worktree.id }}
                      className="text-base leading-5 font-semibold break-words text-foreground no-underline after:absolute after:inset-0 hover:text-brand-700 dark:hover:text-brand-400"
                    >
                      {worktree.name}
                    </Link>
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <FileDiff className="size-3.5" aria-hidden="true" />
                      {worktree.unitCount === 1
                        ? t("repositoryWorktreeUnit")
                        : t("repositoryWorktreeUnits", { count: worktree.unitCount })}
                    </span>
                    <p className="mt-1 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {t("repositoryWorktreeCreatedBy", {
                          name: worktree.creator.displayName,
                          date: formatRelativeDate(worktree.createdAt, language),
                        })}
                      </span>
                      {worktree.processedAt ? (
                        <span>
                          {t("repositoryWorktreeProcessedAt", {
                            state: t(
                              worktree.state === "merged"
                                ? "worktreeStateMerged"
                                : "worktreeStateDiscarded",
                            ),
                            date: formatRelativeDate(worktree.processedAt, language),
                          })}
                        </span>
                      ) : (
                        <span>
                          {t(
                            worktree.state === "draft"
                              ? "worktreeStateDraft"
                              : worktree.state === "merging"
                                ? "worktreeStateMerging"
                                : "worktreeStateReady",
                          )}
                        </span>
                      )}
                    </p>
                    {worktree.summary ? (
                      <p className="mt-1 mb-0 line-clamp-2 text-xs text-muted-foreground">
                        {worktree.summary}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            icon={GitPullRequest}
            title={t(
              normalizedSearch ? "repositoryNoMatchingPullRequests" : "repositoryNoPullRequests",
            )}
            description={t("repositoryNoPullRequestsDescription")}
          >
            <Button variant="secondary" onClick={onOpenWorktrees}>
              {t("repositoryOpenWorkbench")}
            </Button>
          </Empty>
        )}
      </div>
    </section>
  );
}
