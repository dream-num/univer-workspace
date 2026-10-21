import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileDiff, MessageSquare } from "lucide-react";
import type { components } from "../../../../generated/http/schema.js";
import { NodeIcon } from "../../features/nodes/node-icon";
import { spacesQueryOptions } from "../../features/spaces";
import { IssueStateIcon } from "../../features/issues/issue-state";
import type { WorktreeListFilters } from "../../features/worktrees/worktrees.queries";
import { useI18n } from "../../shared/i18n";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { RepositoryPrState, repositoryPrStateLabels } from "./repository-pr-state";
import { PullRequestLink } from "./repository-pull-request-link";
import { repositoryWorktreeSearch } from "./repository-worktree-link";
import { spaceDisplayName } from "./space-name";

export type RepositoryResourceItem = components["schemas"]["OwnedResourceItem"] & {
  readonly lastOpenedAt?: string;
};

export function RepositoryResourceIcon({ item }: { readonly item: RepositoryResourceItem }) {
  return (
    <span className="repository-resource-icon">
      <NodeIcon
        kind="resource"
        name={item.node.name}
        resourceKind={item.resource.kind}
        unitType={item.resource.kind === "univer" ? item.resource.unitType : null}
        mediaType={item.resource.kind === "blob" ? item.resource.mediaType : null}
        variant="list"
      />
    </span>
  );
}

export function RepositoryResourceRows({
  items,
}: {
  readonly items: readonly RepositoryResourceItem[];
}) {
  const { language, t } = useI18n();
  return (
    <ul className="repository-rows">
      {items.map((item) => (
        <li key={item.resource.id}>
          <RepositoryResourceIcon item={item} />
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
              {item.lastOpenedAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">·</span>
                  <time dateTime={item.lastOpenedAt}>
                    {formatRelativeDate(item.lastOpenedAt, language)}
                  </time>
                </span>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RepositoryWorktreeRows({
  items,
  filters = {},
}: {
  readonly items: readonly components["schemas"]["WorktreeSummary"][];
  readonly filters?: WorktreeListFilters;
}) {
  const { t, language } = useI18n();
  const spaces = useQuery(spacesQueryOptions);
  const personal = spaces.data?.spaces.find(
    (s) => s.type === "personal" && s.accessRole === "owner",
  );
  return (
    <ul className="repository-rows">
      {items.map((task) => {
        const search = repositoryWorktreeSearch(task, personal?.id);
        return (
          <li key={task.id}>
            <RepositoryPrState state={task.state} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {search ? (
                  <PullRequestLink
                    target={{ spaceId: search.spaceId, worktree: task, listFilters: filters }}
                    className="repository-row-title"
                  >
                    {task.name}
                  </PullRequestLink>
                ) : (
                  <span className="repository-row-title">{task.name}</span>
                )}
                <span className="repository-label">{t(repositoryPrStateLabels[task.state])}</span>
              </div>
              <div className="repository-row-meta">
                <span>
                  {task.teamSpace?.name ?? spaceDisplayName(personal, t) ?? t("personalSpace")}
                  {task.number !== null ? ` ${t("repositoryPrNumber", { number: task.number })}` : ""}
                </span>
                <span aria-hidden="true">·</span>
                <span>{task.creator.displayName}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={task.updatedAt}>
                  {formatRelativeDate(task.updatedAt, language)}
                </time>
                <span className="ml-auto inline-flex items-center gap-1">
                  <FileDiff aria-hidden="true" className="size-3.5" />
                  {t("repositoryWorktreeUnits", { count: task.unitCount })}
                </span>
              </div>
              {!search ? (
                <p className="mt-2 text-xs text-muted-foreground">{t("dashboardSummaryOnly")}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function RepositoryIssueRows({
  items,
}: {
  readonly items: readonly components["schemas"]["IssueSummary"][];
}) {
  const { language } = useI18n();
  return (
    <ul className="repository-rows">
      {items.map((issue) => (
        <li key={issue.id}>
          <IssueStateIcon issue={issue} className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <Link
              to="/spaces/$spaceId/issues/$number"
              params={{ spaceId: issue.space.id, number: String(issue.number) }}
              search={{}}
              className="repository-row-title"
            >
              {issue.title}
            </Link>
            <div className="repository-row-meta">
              <span>
                {issue.space.name} #{issue.number}
              </span>
              <span aria-hidden="true">·</span>
              <span>{issue.author.displayName}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={issue.updatedAt}>
                {formatRelativeDate(issue.updatedAt, language)}
              </time>
              {issue.commentCount ? (
                <span className="ml-auto inline-flex items-center gap-1">
                  <MessageSquare aria-hidden="true" className="size-3.5" />
                  {issue.commentCount}
                </span>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
