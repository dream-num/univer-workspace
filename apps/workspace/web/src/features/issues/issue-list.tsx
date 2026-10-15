import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  CircleDot,
  MessageSquare,
  Paperclip,
  Search,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { useI18n } from "../../shared/i18n";
import {
  Avatar,
  Button,
  buttonVariants,
  Empty,
  Input,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Spinner,
} from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { IssueLabelChip } from "./issue-label";
import { IssueStateIcon } from "./issue-state";
import {
  DEFAULT_ISSUE_FILTERS,
  issueLabelsQueryOptions,
  issueListQueryOptions,
  type IssueFilters,
} from "./issues.queries";

type IssueSummary = components["schemas"]["IssueSummary"];

const ANY = "__any";
const SORTS = ["created-desc", "created-asc", "updated-desc", "updated-asc"] as const;

/**
 * Filterable Issue list for one Space, or for every Team Space when `spaceId` is omitted.
 * Filters live in the URL, so the parent owns them.
 */
export interface IssueListProps {
  readonly spaceId?: string;
  readonly filters: IssueFilters;
  readonly onFiltersChange: (filters: IssueFilters) => void;
  readonly canCreate?: boolean;
  readonly presentation: "standard" | "compact";
  readonly viewsNav?: ReactNode;
  readonly viewsNavToggle?: ReactNode;
  readonly filterMenuClassName?: string;
}

export function IssueList({
  spaceId,
  filters,
  onFiltersChange,
  canCreate,
  presentation,
  viewsNav,
  viewsNavToggle,
  filterMenuClassName,
}: IssueListProps) {
  const { t } = useI18n();
  const compact = presentation === "compact";
  const query = useInfiniteQuery(issueListQueryOptions(spaceId, filters));
  const labels = useQuery({
    ...issueLabelsQueryOptions(spaceId ?? ""),
    enabled: spaceId !== undefined,
  });
  const [search, setSearch] = useState(filters.q ?? "");
  useEffect(() => setSearch(filters.q ?? ""), [filters.q]);

  const pages = query.data?.pages ?? [];
  const issues = pages.flatMap((page) => page.items);
  const counts = pages[0]?.counts ?? { open: 0, closed: 0 };
  const narrowed =
    filters.labels.length > 0 ||
    Boolean(filters.assignee) ||
    Boolean(filters.author) ||
    Boolean(filters.q);
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    onFiltersChange({ ...filters, q: search.trim() || undefined });
  };

  return (
    <div className={cn("min-w-0", compact && "flex min-h-full")}>
      {viewsNav}
      <div
        className={cn(
          "grid min-w-0 flex-1 content-start gap-4",
          compact && "gap-6 p-6 max-[720px]:p-4",
        )}
      >
        {compact ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {viewsNavToggle}
              <h1 className="m-0 text-xl font-semibold">{t("issues")}</h1>
            </div>
            {spaceId && canCreate ? (
              <Link
                to="/spaces/$spaceId/issues/new"
                params={{ spaceId }}
                search={{}}
                className={cn(buttonVariants({ size: "sm" }), "no-underline")}
              >
                {t("issueNew")}
              </Link>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <form role="search" onSubmit={submitSearch} className="relative min-w-52 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <Input
              aria-label={t("issueSearch")}
              placeholder={t("issueSearch")}
              className={cn("pl-9 pr-16", compact && "h-8 rounded-sm bg-background shadow-none")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="absolute inset-y-0 right-0 flex items-center">
              {search ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("issueClearSearch")}
                  onClick={() => {
                    setSearch("");
                    onFiltersChange({ ...filters, q: undefined });
                  }}
                >
                  <X />
                </Button>
              ) : null}
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                className="h-full rounded-l-none border-l border-border"
                aria-label={t("issueSearch")}
              >
                <Search />
              </Button>
            </div>
          </form>
          {spaceId ? (
            <Link
              to="/spaces/$spaceId/issues/labels"
              params={{ spaceId }}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "no-underline",
                compact && Boolean(viewsNav) && "min-[901px]:hidden",
              )}
            >
              <Tag />
              {t("issueLabels")}
            </Link>
          ) : null}
          {spaceId && canCreate && !compact ? (
            <Link
              to="/spaces/$spaceId/issues/new"
              params={{ spaceId }}
              search={{}}
              className={cn(buttonVariants(), "no-underline")}
            >
              {t("issueNew")}
            </Link>
          ) : null}
        </div>

        {narrowed && issues.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {filters.labels.map((label) => (
              <span key={label} className="rounded-sm border border-border px-2 py-1">
                {t("issueFilterLabel")}: {label}
              </span>
            ))}
            {filters.assignee ? (
              <span>
                {t("issueAssignees")}:{" "}
                {filters.assignee === "me"
                  ? t("issueFilterAssigneeMe")
                  : filters.assignee === "none"
                    ? t("issueFilterAssigneeNone")
                    : filters.assignee}
              </span>
            ) : null}
            {filters.author ? (
              <span>
                {t("issueFilterAuthor")}:{" "}
                {filters.author === "me" ? t("issueFilterAuthorMe") : filters.author}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="w-fit justify-start text-muted-foreground"
              onClick={() => {
                setSearch("");
                onFiltersChange({ ...DEFAULT_ISSUE_FILTERS, state: filters.state });
              }}
            >
              <X />
              {t("issueClearFilters")}
            </Button>
          </div>
        ) : null}
        <section
          aria-label={t("issues")}
          className={cn(
            "overflow-hidden rounded-lg border border-border bg-background",
            compact && "rounded-sm",
          )}
        >
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5",
              compact && "gap-2 bg-surface py-2",
            )}
          >
            <div
              className="flex items-center gap-4 text-sm"
              role="group"
              aria-label={t("issueState")}
            >
              <StateToggle
                active={filters.state === "open"}
                onClick={() => onFiltersChange({ ...filters, state: "open" })}
                icon={compact ? undefined : <CircleDot className="size-4" />}
                label={t("issueStateOpen")}
                count={counts.open}
              />
              <StateToggle
                active={filters.state === "closed"}
                onClick={() => onFiltersChange({ ...filters, state: "closed" })}
                label={t("issueStateClosed")}
                count={counts.closed}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 max-[720px]:w-full">
              <FilterMenu
                className={filterMenuClassName}
                label={t("issueFilterAuthor")}
                value={filters.author ?? ANY}
                onValueChange={(value) =>
                  onFiltersChange({ ...filters, author: value === ANY ? undefined : value })
                }
                options={[
                  { value: ANY, label: t("issueFilterAuthorAny") },
                  { value: "me", label: t("issueFilterAuthorMe") },
                ]}
              />
              {spaceId ? (
                <FilterMenu
                  className={filterMenuClassName}
                  label={t("issueLabels")}
                  value={filters.labels[0] ?? ANY}
                  onValueChange={(value) =>
                    onFiltersChange({ ...filters, labels: value === ANY ? [] : [value] })
                  }
                  options={[
                    { value: ANY, label: t("issueFilterLabelAny") },
                    ...(labels.data ?? []).map((label) => ({
                      value: label.name,
                      label: label.name,
                    })),
                  ]}
                />
              ) : null}
              <FilterMenu
                className={filterMenuClassName}
                label={t("issueAssignees")}
                value={filters.assignee ?? ANY}
                onValueChange={(value) =>
                  onFiltersChange({ ...filters, assignee: value === ANY ? undefined : value })
                }
                options={[
                  { value: ANY, label: t("issueFilterAssigneeAny") },
                  { value: "me", label: t("issueFilterAssigneeMe") },
                  { value: "none", label: t("issueFilterAssigneeNone") },
                ]}
              />
              <FilterMenu
                className={filterMenuClassName}
                label={t(SORT_LABELS[`${filters.sort}-${filters.order}`])}
                value={`${filters.sort}-${filters.order}`}
                onValueChange={(value) => {
                  const [sort, order] = value.split("-") as [
                    IssueFilters["sort"],
                    IssueFilters["order"],
                  ];
                  onFiltersChange({ ...filters, sort, order });
                }}
                options={SORTS.map((value) => ({ value, label: t(SORT_LABELS[value]) }))}
              />
            </div>
          </div>

          {query.isPending ? (
            <div className="grid place-items-center py-14">
              <Spinner />
            </div>
          ) : query.error ? (
            <Empty title={t("issueLoadFailed")} description={query.error.message}>
              <Button variant="secondary" onClick={() => void query.refetch()}>
                {t("repositoryPageRetry")}
              </Button>
            </Empty>
          ) : issues.length === 0 ? (
            <EmptyIssues
              everything={!narrowed && counts.open + counts.closed === 0}
              canCreate={Boolean(spaceId && canCreate)}
              {...(spaceId ? { spaceId } : {})}
              onClear={() =>
                onFiltersChange({
                  ...filters,
                  labels: [],
                  assignee: undefined,
                  author: undefined,
                  q: undefined,
                })
              }
            />
          ) : (
            <>
              <ul className="m-0 list-none p-0">
                {issues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    showSpace={spaceId === undefined}
                    compact={compact}
                  />
                ))}
              </ul>
              {query.hasNextPage ? (
                <div className="grid place-items-center border-t border-border p-3">
                  <Button
                    variant="secondary"
                    disabled={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    {query.isFetchingNextPage ? t("issueLoading") : t("issueLoadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const SORT_LABELS = {
  "created-desc": "issueSortNewest",
  "created-asc": "issueSortOldest",
  "updated-desc": "issueSortRecentlyUpdated",
  "updated-asc": "issueSortLeastRecentlyUpdated",
} as const;

function StateToggle({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon?: React.ReactNode;
  readonly label: string;
  readonly count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-8 items-center gap-1.5 font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
      <span className="rounded-full bg-repository-counter px-1.5 text-xs font-semibold tabular-nums">
        {count.toLocaleString()}
      </span>
    </button>
  );
}

function EmptyIssues({
  everything,
  canCreate,
  spaceId,
  onClear,
}: {
  readonly everything: boolean;
  readonly canCreate: boolean;
  readonly spaceId?: string;
  readonly onClear: () => void;
}) {
  const { t } = useI18n();
  if (!everything) {
    return (
      <Empty icon={Search} title={t("issueNoMatch")} description={t("issueNoMatchDescription")}>
        <Button variant="secondary" onClick={onClear}>
          {t("issueClearFilters")}
        </Button>
      </Empty>
    );
  }
  return (
    <Empty
      icon={CircleDot}
      title={t("issueEmptyTitle")}
      description={spaceId ? t("issueEmptyDescription") : t("issueEmptyMineDescription")}
    >
      {canCreate && spaceId ? (
        <Link
          to="/spaces/$spaceId/issues/new"
          params={{ spaceId }}
          search={{}}
          className={cn(buttonVariants(), "mt-2 no-underline")}
        >
          {t("issueNew")}
        </Link>
      ) : null}
    </Empty>
  );
}

function IssueRow({
  issue,
  showSpace,
  compact,
}: {
  readonly issue: IssueSummary;
  readonly showSpace: boolean;
  readonly compact: boolean;
}) {
  const { language, t } = useI18n();
  const closed = issue.state === "closed";
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to="/spaces/$spaceId/issues/$number"
        params={{ spaceId: issue.space.id, number: String(issue.number) }}
        className={cn(
          "group flex items-start gap-2 px-4 py-3.5 no-underline hover:bg-accent/60",
          compact && "py-2.5",
        )}
      >
        <IssueStateIcon issue={issue} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "font-medium text-foreground group-hover:underline",
                compact && "text-base leading-6 font-semibold",
              )}
            >
              {issue.title}
            </span>
            {issue.labels.map((label) => (
              <IssueLabelChip key={label.id} name={label.name} color={label.color} />
            ))}
          </p>
          <p className={cn("mt-1 mb-0 text-sm text-muted-foreground", compact && "text-xs")}>
            {showSpace ? <span>{issue.space.name} · </span> : null}
            {closed && issue.closedAt
              ? t("issueClosedBy", {
                  number: issue.number,
                  name: (issue.closedBy ?? issue.author).displayName,
                  date: formatRelativeDate(issue.closedAt, language),
                })
              : t("issueOpenedBy", {
                  number: issue.number,
                  name: issue.author.displayName,
                  date: formatRelativeDate(issue.createdAt, language),
                })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground max-[720px]:hidden">
          {issue.assignees.length ? (
            <span
              className="flex -space-x-1.5"
              title={issue.assignees.map((user) => user.displayName).join(", ")}
            >
              {issue.assignees.slice(0, 3).map((user) => (
                <Avatar
                  key={user.id}
                  src={user.avatarUrl}
                  name={user.displayName}
                  size="xs"
                  className="ring-2 ring-background"
                />
              ))}
              {issue.assignees.length > 3 ? (
                <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] ring-2 ring-background">
                  +{issue.assignees.length - 3}
                </span>
              ) : null}
            </span>
          ) : null}
          {issue.referenceCount ? (
            <span
              className="flex items-center gap-1 tabular-nums"
              title={t("issueReferenceCount", { count: issue.referenceCount })}
            >
              <Paperclip className="size-3.5" />
              {issue.referenceCount}
            </span>
          ) : null}
          {issue.commentCount ? (
            <span
              className="flex items-center gap-1 tabular-nums"
              title={t("issueCommentCount", { count: issue.commentCount })}
            >
              <MessageSquare className="size-3.5" />
              {issue.commentCount}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function FilterMenu({
  className,
  label,
  value,
  options,
  onValueChange,
}: {
  readonly className?: string | undefined;
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onValueChange: (value: string) => void;
}) {
  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-muted-foreground"
            aria-label={label}
          >
            {label}
            <ChevronDown className="size-3" />
          </Button>
        }
      />
      <MenuContent
        align="end"
        className={cn(
          "max-h-72 overflow-y-auto",
          className,
        )}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            role="menuitemradio"
            aria-checked={option.value === value}
            onClick={() => onValueChange(option.value)}
          >
            <Check className={cn("size-4", option.value !== value && "invisible")} />
            {option.label}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
