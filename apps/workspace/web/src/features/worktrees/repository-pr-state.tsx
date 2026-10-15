import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import type { components } from "../../../../generated/http/schema.js";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { cn } from "../../shared/utils/cn";

type State = components["schemas"]["WorktreeState"];
export const OPEN_WORKTREE_STATES: readonly State[] = ["draft", "ready", "merging"];
const labels: Record<State, MessageKey> = {
  draft: "worktreeStateDraft",
  ready: "worktreeStateReady",
  merging: "worktreeStateMerging",
  merged: "worktreeStateMerged",
  discarded: "worktreeStateDiscarded",
};

export function RepositoryPrState({
  state,
  badge = false,
}: {
  readonly state: State;
  readonly badge?: boolean;
}) {
  const { t } = useI18n();
  const Icon =
    state === "merged"
      ? GitMerge
      : state === "discarded"
        ? GitPullRequestClosed
        : state === "draft"
          ? GitPullRequestDraft
          : GitPullRequest;
  return (
    <span
      data-pr-state={state}
      role={badge ? undefined : "img"}
      aria-label={badge ? undefined : t(labels[state])}
      title={t(labels[state])}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5",
        badge ? "rounded-full px-3 py-1.5 text-sm font-medium text-white" : "mt-0.5",
        badge
          ? state === "draft"
            ? "bg-muted-foreground"
            : state === "merged"
              ? "bg-state-merged"
              : state === "discarded"
                ? "bg-state-closed"
                : "bg-primary"
          : state === "draft"
            ? "text-muted-foreground"
            : state === "merged"
              ? "text-state-merged"
              : state === "discarded"
                ? "text-state-closed"
                : "text-state-open",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {badge ? t(labels[state]) : null}
    </span>
  );
}
