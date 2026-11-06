import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleDot, MessageSquare, Paperclip, Plus, Search, Tag, X } from "lucide-react";
import type { components } from "../../../../../generated/http/schema.js";
import { IssueFilterMenu } from "../../../features/issues/issue-filter-menu";
import { IssueStateIcon } from "../../../features/issues/issue-state";
import type { IssueListModelProps } from "../../../features/issues/use-issue-list-model";
import { ISSUE_FILTER_ANY as ANY, ISSUE_SORTS, ISSUE_SORT_LABELS, useIssueListModel } from "../../../features/issues/use-issue-list-model";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import { Avatar, Button, buttonVariants, Empty, Input, Spinner } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { IssueSubnav } from "./issue-subnav";

type IssueSummary = components["schemas"]["IssueSummary"];

export function RepositoryIssueList({ spaceId, filters, onFiltersChange, canCreate }: IssueListModelProps & { readonly canCreate?: boolean }) {
  const { t } = useI18n();
  const model = useIssueListModel({ ...(spaceId ? { spaceId } : {}), filters, onFiltersChange });
  const { query, issues, counts, labels, narrowed, search, setSearch, submitSearch, clearSearch, resetFilters } = model;
  // shortcut: global label choices cover loaded issues, use a global labels endpoint when one exists.
  const labelNames = [...new Set([...filters.labels, ...(spaceId ? (labels.data ?? []).map((label) => label.name) : issues.flatMap((issue) => issue.labels.map((label) => label.name)))])];
  return (
    <div className={cn("rd-issues", spaceId && "rd-issues-grid")}>
      {spaceId ? <IssueSubnav spaceId={spaceId} filters={filters} labels={labels.data ?? []} /> : null}
      <section className="rd-issue-main" aria-label={t("issues")}>
        <div className="rd-issue-heading">
          <h1>{t("issues")}</h1>
          {spaceId && canCreate ? (
            <Link to="/spaces/$spaceId/issues/new" params={{ spaceId }} search={{}} className={cn(buttonVariants(), "rd-issue-new")}>
              <Plus aria-hidden="true" />{t("issueNew")}
            </Link>
          ) : null}
        </div>
        <form role="search" onSubmit={submitSearch} className="rd-issue-search">
          <Search aria-hidden="true" />
          <Input aria-label={t("issueSearch")} placeholder={t("issueSearch")} value={search} onChange={(event) => setSearch(event.target.value)} />
          {search ? <Button variant="ghost" size="icon-sm" onClick={clearSearch} aria-label={t("issueClearSearch")}><X /></Button> : null}
        </form>
        {narrowed ? (
          <div className="rd-issue-active-filters">
            {filters.labels.map((label) => <span key={label}><Tag aria-hidden="true" />{label}</span>)}
            {filters.author ? <span>{t("issueFilterAuthor")}: {filters.author === "me" ? t("issueFilterAuthorMe") : filters.author}</span> : null}
            {filters.assignee ? <span>{t("issueFilterAssignee")}: {filters.assignee === "me" ? t("repositoryIssuesAssigned") : filters.assignee === "none" ? t("issueFilterAssigneeNone") : filters.assignee}</span> : null}
            <Button variant="ghost" size="sm" onClick={resetFilters}><X />{t("issueClearFilters")}</Button>
          </div>
        ) : null}
        <div className="rd-issue-list" aria-busy={query.isFetching}>
          <div className="rd-issue-list-head">
            <div className="rd-issue-segments" role="group" aria-label={t("issueState")}>
              {(["open", "closed"] as const).map((state) => {
                const Icon = state === "open" ? CircleDot : CircleCheck;
                return (
                  <button key={state} type="button" aria-pressed={filters.state === state} onClick={() => onFiltersChange({ ...filters, state })}>
                    <Icon aria-hidden="true" />{t(state === "open" ? "issueStateOpen" : "issueStateClosed")}
                    <span className="rd-issue-count">{counts[state].toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
            <div className="rd-issue-filters">
              <div className="rd-issue-select">
                <IssueFilterMenu
                  label={filters.author === "me" ? t("issueFilterAuthorMe") : filters.author ?? t("issueFilterAuthor")}
                  value={filters.author ?? ANY}
                  onValueChange={(value) => onFiltersChange({ ...filters, author: value === ANY ? undefined : value })}
                  options={[{ value: ANY, label: t("issueFilterAuthorAny") }, { value: "me", label: t("issueFilterAuthorMe") }]}
                />
              </div>
              <div className="rd-issue-select" title={spaceId ? undefined : t("repositoryIssuesLoadedLabels")}>
                <IssueFilterMenu
                  label={filters.labels[0] ?? t("issueFilterLabel")}
                  value={filters.labels[0] ?? ANY}
                  onValueChange={(value) => onFiltersChange({ ...filters, labels: value === ANY ? [] : [value] })}
                  options={[{ value: ANY, label: t("issueFilterLabelAny") }, ...labelNames.map((name) => ({ value: name, label: name }))]}
                />
              </div>
              <div className="rd-issue-select">
                <IssueFilterMenu
                  label={filters.assignee === "me" ? t("repositoryIssuesAssigned") : filters.assignee === "none" ? t("issueFilterAssigneeNone") : filters.assignee ?? t("issueFilterAssignee")}
                  value={filters.assignee ?? ANY}
                  onValueChange={(value) => onFiltersChange({ ...filters, assignee: value === ANY ? undefined : value })}
                  options={[{ value: ANY, label: t("issueFilterAssigneeAny") }, { value: "me", label: t("issueFilterAssigneeMe") }, { value: "none", label: t("issueFilterAssigneeNone") }]}
                />
              </div>
              <div className="rd-issue-select">
                <IssueFilterMenu
                  label={t(ISSUE_SORT_LABELS[`${filters.sort}-${filters.order}`])}
                  value={`${filters.sort}-${filters.order}`}
                  onValueChange={(value) => {
                    const sort = ISSUE_SORTS.find((sort) => sort === value);
                    if (sort) onFiltersChange({ ...filters, sort: sort.startsWith("created-") ? "created" : "updated", order: sort.endsWith("-asc") ? "asc" : "desc" });
                  }}
                  options={ISSUE_SORTS.map((value) => ({ value, label: t(ISSUE_SORT_LABELS[value]) }))}
                />
              </div>
            </div>
          </div>
          {query.isPending ? <div className="rd-issue-loading" role="status" aria-label={t("issueLoading")}><Spinner /></div> : query.error ? (
            <Empty title={t("issueLoadFailed")} description={query.error.message}>
              <Button variant="secondary" onClick={() => void query.refetch()}>{t("repositoryPageRetry")}</Button>
            </Empty>
          ) : issues.length === 0 ? (
            <Empty icon={narrowed ? Search : CircleDot} title={t(narrowed ? "issueNoMatch" : counts.open + counts.closed === 0 ? "issueEmptyTitle" : filters.state === "closed" ? "issueNoClosed" : "issueNoOpen")} description={t(narrowed ? "issueNoMatchDescription" : spaceId ? "issueEmptyDescription" : "issueEmptyMineDescription")}>
              <Button variant="secondary" onClick={resetFilters}>{t("issueClearFilters")}</Button>
            </Empty>
          ) : (
            <ul className="rd-issue-rows">
              {issues.map((issue) => <RepositoryIssueRow key={issue.id} issue={issue} showSpace={spaceId === undefined} />)}
            </ul>
          )}
          {query.hasNextPage ? (
            <div className="rd-issue-load-more"><Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t(query.isFetchingNextPage ? "issueLoading" : "issueLoadMore")}</Button></div>
          ) : null}
        </div>
        {spaceId ? <Link to="/spaces/$spaceId/issues/labels" params={{ spaceId }} className="rd-issue-manage-labels"><Tag aria-hidden="true" />{t("issueLabels")}</Link> : null}
        {labels.error ? <p className="rd-issue-facet-note" role="alert">{labels.error.message} <Button variant="ghost" size="sm" onClick={() => void labels.refetch()}>{t("repositoryPageRetry")}</Button></p> : null}
      </section>
    </div>
  );
}

function RepositoryIssueRow({ issue, showSpace }: { readonly issue: IssueSummary; readonly showSpace: boolean }) {
  const { t, language } = useI18n();
  const closed = issue.state === "closed" && issue.closedAt;
  return (
    <li>
      <Link to="/spaces/$spaceId/issues/$number" params={{ spaceId: issue.space.id, number: String(issue.number) }} className="rd-issue-row">
        <IssueStateIcon issue={issue} className="rd-issue-state" />
        <div className="rd-issue-content">
          <div className="rd-issue-title">
            <span className="rd-issue-title-text">{issue.title}</span>
            {issue.labels.map((label) => <span key={label.id} className="rd-issue-label" data-color={label.color}><i aria-hidden="true" />{label.name}</span>)}
          </div>
          <div className="rd-issue-meta">
            {showSpace ? <span>{issue.space.name}</span> : null}
            <span>{closed ? t("repositoryIssueClosedBy", { number: issue.number, date: formatRelativeDate(closed, language), name: (issue.closedBy ?? issue.author).displayName }) : t("repositoryIssueOpenedBy", { number: issue.number, date: formatRelativeDate(issue.createdAt, language), name: issue.author.displayName })}</span>
          </div>
        </div>
        <div className="rd-issue-right">
          <span className="rd-issue-assignees" title={issue.assignees.map((user) => user.displayName).join(", ")}>
            {issue.assignees.slice(0, 3).map((user) => <span key={user.id} className="rd-avatar"><Avatar name={user.displayName} src={user.avatarUrl} size="xs" /></span>)}
            {issue.assignees.length > 3 ? <span className="rd-issue-count">+{issue.assignees.length - 3}</span> : null}
          </span>
          {issue.referenceCount ? <span className="rd-issue-comments" title={t("issueReferenceCount", { count: issue.referenceCount })}><Paperclip aria-hidden="true" />{issue.referenceCount}</span> : null}
          <span className="rd-issue-comments" data-empty={issue.commentCount === 0} title={t("issueCommentCount", { count: issue.commentCount })}><MessageSquare aria-hidden="true" />{issue.commentCount}</span>
        </div>
      </Link>
    </li>
  );
}
