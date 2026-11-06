import { Globe, LockKeyhole, Settings, Star, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { spaceStarQueryOptions } from "../../../../features/spaces";
import { teamMembersQueryOptions } from "../../../../features/permissions/permissions.queries";
import { useI18n } from "../../../../shared/i18n";
import type { QueryView, RepositoryActivity } from "../../data";
import { ActorAvatar } from "../../code/actor-avatar";
import { ActivityEventLine } from "../../code/activity-event";
import { repositoryMembers } from "../../code/team-members";
import type { SpaceView } from "./types";

export function AboutRail({
  space,
  activity,
}: {
  readonly space: SpaceView;
  readonly activity: QueryView<RepositoryActivity>;
}) {
  const { t, language } = useI18n();
  const star = useQuery(spaceStarQueryOptions(space.id));
  const members = useQuery({
    ...teamMembersQueryOptions(space.id),
    enabled: space.type === "team",
  });
  const people =
    space.type === "team" && members.data ? repositoryMembers(members.data) : undefined;
  return (
    <aside className="rd-about" aria-label={t("repositoryAbout")}>
      <section>
        <div className="rd-about-heading">
          <h3>{t("repositoryAbout")}</h3>
          {space.capabilities.renameSpace ? (
            <Link
              to="/spaces/$spaceId/settings"
              params={{ spaceId: space.id }}
              aria-label={t("repositoryAboutEditDescription")}
            >
              <Settings aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {space.description.trim() ? <p className="rd-description">{space.description}</p> : null}
        <ul className="rd-facts">
          <li>
            {space.publicRead ? <Globe aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
            {t(space.publicRead ? "repositoryVisibilityPublic" : "repositoryVisibilityPrivate")}
          </li>
          <li>
            <Star aria-hidden="true" />
            <span className="rd-num">{star.data?.starCount.toLocaleString(language) ?? "…"}</span>
            {t("repositoryAboutStars", { count: star.data?.starCount ?? 0 })}
          </li>
          {people ? (
            <li>
              <Users aria-hidden="true" />
              <span className="rd-num">{people.length}</span>
              {t("repositoryAboutMembers", { count: people.length })}
            </li>
          ) : null}
        </ul>
      </section>
      {people ? (
        <section>
          <h3>{t("repositoryMetaMembers")}</h3>
          <div className="rd-stack">
            {people.map((user) => (
              <ActorAvatar key={user.id} actor={{ user, source: "unknown" }} />
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h3>{t("repositoryRecentActivity")}</h3>
        {activity.status === "success" ? (
          <>
            <ul className="rd-acts">
              {activity.data.events.slice(0, 4).map((event) => (
                <li
                  key={`${event.kind}-${"pull" in event ? event.pull.id : event.issue.number}-${event.at}`}
                >
                  <ActivityEventLine event={event} />
                </li>
              ))}
            </ul>
            {activity.data.events.length === 0 ? (
              <p className="rd-data-note">{t("repositoryNoActivity")}</p>
            ) : null}
            {!activity.data.complete ? (
              <p className="rd-data-note">{t("repositoryPartialData")}</p>
            ) : null}
          </>
        ) : (
          <p className="rd-data-note">
            {t(activity.status === "pending" ? "dashboardLoading" : "dashboardLoadFailed")}
          </p>
        )}
      </section>
    </aside>
  );
}
