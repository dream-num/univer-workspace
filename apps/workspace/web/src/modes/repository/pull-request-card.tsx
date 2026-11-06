import { FileDiff } from "lucide-react";
import type { WorktreeListFilters } from "../../features/worktrees/worktrees.queries";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { useI18n } from "../../shared/i18n";
import { ActorAvatar } from "./code/actor-avatar";
import type { PullCardModel } from "./data";
import { RepositoryPrState } from "./repository-pr-state";
import { PullRequestLink } from "./repository-pull-request-link";

export function PullRequestCard({ item, listFilters = {} }: {
  readonly item: PullCardModel;
  readonly listFilters?: WorktreeListFilters;
}) {
  const { t, language } = useI18n();
  const name =
    item.actor.user?.displayName || item.actor.user?.username || t("repositoryUnknownActor");
  const repository = item.space?.name ?? t("personalSpace");
  const content = (
    <>
      <div className="rd-mc-t">
        <span className="rd-tt">{item.pull.title}</span>
        <RepositoryPrState state={item.pull.state} badge />
      </div>
      <div className="rd-mc-fig">
        <FileDiff aria-hidden="true" />
        {t("repositoryWorktreeUnits", { count: item.files })}
      </div>
      <p className="rd-mc-d">
        {item.summary ||
          t("repositoryHomePullDescription", { name, count: item.files, repository })}
      </p>
      <div className="rd-mc-m">
        <span>
          <ActorAvatar actor={item.actor} size="sm" />
          <span className="rd-by">{name}</span>
        </span>
        {item.pull.number !== null ? (
          <span className="rd-num">#{item.pull.number}</span>
        ) : null}
        <span>{repository}</span>
        <time dateTime={item.updatedAt}>{formatRelativeDate(item.updatedAt, language)}</time>
        {!item.canReview ? <span>{t("dashboardSummaryOnly")}</span> : null}
      </div>
    </>
  );
  return item.canReview ? (
    <PullRequestLink
      className="rd-mcard"
      target={{ spaceId: item.pull.spaceId ?? undefined, worktree: item.pull, listFilters }}
    >
      {content}
    </PullRequestLink>
  ) : (
    <div className="rd-mcard">
      {content}
    </div>
  );
}
