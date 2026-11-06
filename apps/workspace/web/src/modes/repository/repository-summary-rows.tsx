import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { components } from "../../../../generated/http/schema.js";
import { TypeBadge } from "./code/repository-file-table";
import { mySpacesQueryOptions } from "../../features/spaces";
import type { WorktreeListFilters } from "../../features/worktrees/worktrees.queries";
import { useI18n } from "../../shared/i18n";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { PullRequestCard } from "./pull-request-card";
import { repositoryWorktreeSearch } from "./repository-worktree-link";
import { spaceDisplayName } from "./space-name";

export type RepositoryResourceItem = components["schemas"]["OwnedResourceItem"] & {
  readonly lastOpenedAt?: string;
};

export function RepositoryResourceRows({
  items,
}: {
  readonly items: readonly RepositoryResourceItem[];
}) {
  const { language, t } = useI18n();
  return (
    <ul className="repository-rows repository-recent-rows">
      {items.map((item) => (
        <li key={item.resource.id}>
          <TypeBadge type={item.resource.kind === "univer" ? item.resource.unitType : "blob"} />
          <div className="min-w-0 flex-1">
            <Link
              to="/nodes/$nodeId"
              params={{ nodeId: item.node.id }}
              search={{}}
              className="repository-row-title"
            >
              {item.node.name}
            </Link>
            <div className="repository-row-meta">
              <span className="break-all">
                {spaceDisplayName(item.location.space, t)}
                {item.location.breadcrumbs.length
                  ? ` / ${item.location.breadcrumbs.map((b) => b.name).join(" / ")}`
                  : ""}
              </span>
            </div>
          </div>
          {item.lastOpenedAt ? (
            <time className="rd-last-opened" dateTime={item.lastOpenedAt}>
              {t("repositoryLastOpened", { date: formatRelativeDate(item.lastOpenedAt, language) })}
            </time>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function RepositoryWorktreeRows({
  items,
  filters = {},
  spaceId,
}: {
  readonly items: readonly components["schemas"]["WorktreeSummary"][];
  readonly filters?: WorktreeListFilters;
  readonly spaceId?: string;
}) {
  const spaces = useQuery(mySpacesQueryOptions);
  const personal = spaces.data?.spaces.find(
    (s) => s.type === "personal" && s.accessRole === "owner",
  );
  return (
    <ul className="rd-mcards repository-pull-cards">
      {items.map((task) => {
        const search = repositoryWorktreeSearch(task, personal?.id);
        return (
          <li key={task.id}>
            <PullRequestCard
              listFilters={filters}
              item={{
                pull: {
                  id: task.id,
                  number: task.number,
                  title: task.name,
                  state: task.state,
                  spaceId: spaceId ?? search?.spaceId ?? null,
                },
                space: task.teamSpace ?? (task.kind === "user" ? personal ?? null : null),
                actor: { user: task.creator, source: "unknown" },
                canReview: task.capabilities.review,
                files: task.unitCount,
                summary: task.summary,
                updatedAt: task.updatedAt,
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
