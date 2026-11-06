import { Bot, UserRound } from "lucide-react";
import { useI18n } from "../../../shared/i18n";
import type { PendingChange } from "../data";
import { PullRequestLink } from "../repository-pull-request-link";

export function PendingChip({ change }: { readonly change: PendingChange }) {
  const { t } = useI18n();
  const labels = {
    modified: "repositoryPendingEdited",
    added: "repositoryPendingAdded",
    deleted: "repositoryPendingDeleted",
  } as const;
  return (
    <PullRequestLink
      className="rd-pending"
      data-actor={change.actor.kind}
      target={{ spaceId: change.pull.spaceId ?? undefined, worktree: change.pull }}
    >
      {change.actor.kind === "agents" ? <Bot aria-hidden="true" /> : <UserRound aria-hidden="true" />}
      <span className="rd-num">
        {change.pull.number === null ? t("repositoryPullRequest") : `#${change.pull.number}`}
      </span>
      {t(labels[change.kind])}
      {change.scope === "inside" ? <span>{t("repositoryPendingInside")}</span> : null}
    </PullRequestLink>
  );
}
