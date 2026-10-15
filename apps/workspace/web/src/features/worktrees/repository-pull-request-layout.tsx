import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Database,
  FileDiff,
  FileText,
  MessageSquareText,
  Presentation,
  Shapes,
  Table2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { useI18n } from "../../shared/i18n";
import { Avatar, buttonVariants } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { RepositoryPrState } from "./repository-pr-state";
import type { WorktreeReviewView } from "./worktree-review-search";

export interface RepositoryReviewPresentation {
  readonly spaceId: string;
  readonly section: "overview" | "files";
}

/** Only presentation: mutations, permissions and document runtimes stay in the review panel. */
export function RepositoryPullRequestLayout({
  worktree,
  presentation,
  selectedUnitId,
  selectedView,
  review,
  actions,
}: {
  readonly worktree: components["schemas"]["WorktreeDetail"];
  readonly presentation: RepositoryReviewPresentation;
  readonly selectedUnitId: string | undefined;
  readonly selectedView: WorktreeReviewView;
  readonly review: ReactNode;
  readonly actions: ReactNode;
}) {
  const { t, language } = useI18n();
  const { spaceId, section } = presentation;
  const search = {
    spaceId,
    worktree: worktree.id,
    ...(selectedUnitId ? { unit: selectedUnitId } : {}),
    view: selectedView,
  };
  const filesLink = { ...search, section: "files" as const };
  const documents = (
    <nav aria-label={t("repositoryPrFiles")} className="min-w-0">
      <h2 className="m-0 mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
        {t("repositoryPrFiles")}
        <span className="rounded-full bg-repository-counter px-2 tabular-nums">
          {worktree.units.length}
        </span>
      </h2>
      {worktree.units.length ? (
        <ul className="m-0 grid list-none gap-1 p-0">
          {worktree.units.map((unit) => {
            const Icon = {
              sheet: Table2,
              doc: FileText,
              slide: Presentation,
              board: Shapes,
              base: Database,
            }[unit.unitType];
            return (
              <li key={unit.unitId} className="min-w-0">
                <Link
                  to="/worktrees"
                  search={{ ...filesLink, unit: unit.unitId }}
                  activeOptions={{ exact: true, includeSearch: true }}
                  aria-current={
                    section === "files" && unit.unitId === selectedUnitId ? "true" : undefined
                  }
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground no-underline hover:bg-accent",
                    section === "files" &&
                      unit.unitId === selectedUnitId &&
                      "bg-accent font-semibold",
                  )}
                >
                  <Icon
                    className="size-4 shrink-0 text-muted-foreground"
                    role="img"
                    aria-label={t(unit.unitType)}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 break-words",
                      unit.change === "deleted" && "line-through",
                    )}
                  >
                    {unit.name || unit.unitId}
                  </span>
                  <span
                    className="shrink-0 text-xs text-muted-foreground"
                    role="img"
                    aria-label={t(
                      unit.change === "added"
                        ? "documentAdded"
                        : unit.change === "deleted"
                          ? "documentDeleted"
                          : unit.change === "modified"
                            ? "documentModified"
                            : "documentUnchanged",
                    )}
                  >
                    {unit.change === "added"
                      ? "+"
                      : unit.change === "deleted"
                        ? "−"
                        : unit.change === "modified"
                          ? "M"
                          : "="}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">{t("noAgentDocuments")}</p>
      )}
    </nav>
  );
  const reviewActions = (
    <section
      aria-label={t("repositoryPrReview")}
      className="overflow-hidden rounded-md border border-border"
    >
      <div className="flex items-start gap-3 p-4">
        <RepositoryPrState state={worktree.state} />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-semibold">{t("repositoryPrReview")}</h2>
          {!worktree.processedAt ? (
            <p className="mt-1 mb-0 text-sm text-muted-foreground">{t("repositoryPrReviewHint")}</p>
          ) : null}
          {worktree.processedAt ? (
            <p className="mt-2 mb-0 text-sm text-muted-foreground">
              {t("repositoryWorktreeProcessedAt", {
                state: t(
                  worktree.state === "merged" ? "worktreeStateMerged" : "worktreeStateDiscarded",
                ),
                date: formatRelativeDate(worktree.processedAt, language),
              })}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface p-4 [&_button]:max-w-full [&_button]:whitespace-normal">
        {section === "overview" ? (
          <Link
            to="/worktrees"
            search={filesLink}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "no-underline")}
          >
            <FileDiff className="size-4" />
            {t("repositoryPrViewFiles")}
          </Link>
        ) : null}
        {actions}
      </div>
    </section>
  );

  return (
    <div className="repository-chrome repository-pull-requests min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto grid max-w-7xl gap-4 px-8 py-6 max-[720px]:px-4">
        <Link
          to="/spaces/$spaceId"
          params={{ spaceId }}
          search={{ view: "prs" }}
          className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground no-underline hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t("repositoryPrBack")}
        </Link>
        <header className="grid gap-2">
          <h1 className="m-0 text-[32px] leading-10 font-normal break-words max-[720px]:text-2xl max-[720px]:leading-8">
            {worktree.name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            <RepositoryPrState state={worktree.state} badge />
            <span>
              {t("repositoryWorktreeCreatedBy", {
                name: worktree.creator.displayName,
                date: formatRelativeDate(worktree.createdAt, language),
              })}
            </span>
          </div>
        </header>
        <nav aria-label={t("repositoryPullRequests")} className="flex gap-1 border-b border-border">
          {(["overview", "files"] as const).map((value) => {
            const Icon = value === "overview" ? MessageSquareText : FileDiff;
            return (
              <Link
                key={value}
                to="/worktrees"
                search={{ ...search, section: value }}
                activeOptions={{ exact: true, includeSearch: true }}
                aria-current={section === value ? "page" : undefined}
                className={cn(
                  "relative -mb-px flex items-center gap-2 rounded-t-md border px-4 py-2 text-sm text-foreground no-underline hover:text-muted-foreground max-[720px]:px-3",
                  section === value
                    ? "border-border border-b-background bg-background font-semibold"
                    : "border-transparent",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {t(value === "overview" ? "repositoryPrOverview" : "repositoryPrFiles")}
                {value === "files" ? (
                  <span className="rounded-full bg-repository-counter px-2 text-xs tabular-nums">
                    {worktree.units.length}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        {section === "overview" ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_296px]">
            <div className="grid min-w-0 gap-6">
              <div className="flex items-start gap-4">
                <Avatar
                  name={worktree.creator.displayName}
                  src={worktree.creator.avatarUrl}
                  size="lg"
                  className="max-[720px]:hidden"
                />
                <section
                  aria-label={t("repositoryPrSummary")}
                  className="min-w-0 flex-1 overflow-hidden rounded-md border border-border"
                >
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border bg-surface px-4 py-2 text-sm text-muted-foreground">
                    <strong className="text-foreground">{worktree.creator.displayName}</strong>
                    <span>{formatRelativeDate(worktree.createdAt, language)}</span>
                  </div>
                  <div className="px-4 py-5">
                    <h2 className="m-0 mb-3 text-base font-semibold">{t("repositoryPrSummary")}</h2>
                    <p
                      className={cn(
                        "m-0 text-sm leading-6 whitespace-pre-wrap break-words",
                        !worktree.summary && "italic text-muted-foreground",
                      )}
                    >
                      {worktree.summary || t("repositoryPrNoSummary")}
                    </p>
                  </div>
                </section>
              </div>
              <div className="relative ml-14 grid gap-4 before:absolute before:-top-6 before:bottom-full before:left-4 before:border-l-2 before:border-border max-[720px]:ml-0">
                {reviewActions}
              </div>
            </div>
            <aside className="grid min-w-0 gap-4 divide-y divide-border text-sm [&>section]:pb-4">
              <section>
                <h2 className="m-0 mb-2 text-xs font-semibold text-muted-foreground">
                  {t("repositoryPrAuthor")}
                </h2>
                <div className="flex items-center gap-2">
                  <Avatar
                    name={worktree.creator.displayName}
                    src={worktree.creator.avatarUrl}
                    size="xs"
                  />
                  <strong className="break-words">{worktree.creator.displayName}</strong>
                </div>
              </section>
              <section>{documents}</section>
              <section>
                <h2 className="m-0 mb-2 text-xs font-semibold text-muted-foreground">
                  {t("repositoryPrUpdated")}
                </h2>
                {formatRelativeDate(worktree.updatedAt, language)}
              </section>
              <section>
                <h2 className="m-0 mb-2 text-xs font-semibold text-muted-foreground">
                  {t("repositoryPrId")}
                </h2>
                <code className="text-xs break-all text-muted-foreground">{worktree.id}</code>
              </section>
            </aside>
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="min-w-0 rounded-md border border-border p-3">{documents}</aside>
            <div className="grid min-w-0 gap-4">
              <div className="@container/review flex h-[max(640px,75dvh)] min-w-0 flex-col overflow-hidden rounded-md border border-border">
                {review}
              </div>
              {reviewActions}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
