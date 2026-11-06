import { Link } from "@tanstack/react-router";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import type { ActivityEvent } from "../data";
import { PullRequestLink } from "../repository-pull-request-link";
import { ActorAvatar } from "./actor-avatar";

export function ActivityEventLine({ event }: { readonly event: ActivityEvent }) {
  const { t, language } = useI18n();
  const verb = {
    "pull-opened": "repositoryEventPullOpened",
    "pull-merged": "repositoryEventPullMerged",
    "issue-opened": "repositoryEventIssueOpened",
    "issue-closed": "repositoryEventIssueClosed",
  } as const;
  return (
    <>
      <ActorAvatar actor={event.actor} size="sm" />
      <div className="rd-event-text">
        <b>
          {event.actor.user?.displayName ||
            event.actor.user?.username ||
            t("repositoryUnknownActor")}
        </b>{" "}
        {t(verb[event.kind])}{" "}
        {"pull" in event ? (
          <PullRequestLink
            target={{ spaceId: event.pull.spaceId ?? undefined, worktree: event.pull }}
          >
            {event.pull.number === null ? "" : `#${event.pull.number} `}
            {event.pull.title}
          </PullRequestLink>
        ) : (
          <Link
            to="/spaces/$spaceId/issues/$number"
            params={{ spaceId: event.issue.spaceId, number: String(event.issue.number) }}
          >
            #{event.issue.number} {event.issue.title}
          </Link>
        )}
      </div>
      <time
        className="rd-event-when"
        dateTime={event.at}
        title={new Date(event.at).toLocaleString(language)}
      >
        {formatRelativeDate(event.at, language)}
      </time>
    </>
  );
}
