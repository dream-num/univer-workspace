import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, CircleDot, PencilLine, UserRoundCheck } from "lucide-react";
import type { components } from "../../../../../generated/http/schema.js";
import { sessionQueryOptions } from "../../../features/auth";
import type { IssueFilters } from "../../../features/issues/issues.queries";
import { searchFromFilters } from "../../../features/issues/issue-search";
import { useI18n } from "../../../shared/i18n";
import { useOpenIssueFacets } from "../data";
import { activeIssueView, issueViewSearch, type IssueView } from "./issue-views";

export function IssueSubnav({ spaceId, filters, labels }: {
  readonly spaceId: string;
  readonly filters: IssueFilters;
  readonly labels: readonly components["schemas"]["IssueLabel"][];
}) {
  const { t } = useI18n();
  const session = useQuery(sessionQueryOptions);
  const me = session.data?.authenticated ? session.data.user.id : "";
  const facets = useOpenIssueFacets(spaceId, me);
  const counts = facets.status === "success" && facets.data.exact ? facets.data : undefined;
  const active = activeIssueView(filters);
  const views = [
    { view: "all", label: t("issues"), icon: CircleDot, count: counts?.open },
    { view: "assigned", label: t("repositoryIssuesAssigned"), icon: UserRoundCheck, count: counts?.assignedToMe },
    { view: "created", label: t("issueFilterAuthorMe"), icon: PencilLine, count: counts?.createdByMe },
    { view: "recent", label: t("issueRecentActivity"), icon: Activity, count: counts?.recentlyActive },
  ] satisfies readonly { view: IssueView; label: string; icon: typeof CircleDot; count: number | undefined }[];
  return (
    <nav className="rd-issue-subnav" aria-label={t("issueViews")}>
      {views.map(({ view, label, icon: Icon, count }) => (
        <Link
          key={view}
          to="/spaces/$spaceId/issues"
          params={{ spaceId }}
          search={issueViewSearch(filters, view)}
          aria-current={active === view ? "page" : undefined}
          className="rd-issue-view"
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
          {count !== undefined ? (
            <span className="rd-issue-count" title={t(view === "recent" ? "repositoryIssuesRecentCount" : "repositoryIssuesOpenCount")}>
              {count.toLocaleString()}
            </span>
          ) : null}
        </Link>
      ))}
      <h3>
        <Link to="/spaces/$spaceId/issues/labels" params={{ spaceId }}>{t("issueLabels")}</Link>
      </h3>
      {labels.map((label) => {
        const selected = filters.labels.includes(label.name);
        return (
          <Link
            key={label.id}
            to="/spaces/$spaceId/issues"
            params={{ spaceId }}
            search={searchFromFilters({ ...filters, labels: selected ? filters.labels.filter((name) => name !== label.name) : [...filters.labels, label.name] })}
            aria-current={selected ? "page" : undefined}
            className="rd-issue-view rd-issue-label-filter"
          >
            <i className="rd-issue-label-dot" data-color={label.color} aria-hidden="true" />
            <span>{label.name}</span>
            {counts ? <span className="rd-issue-count" title={t("repositoryIssuesOpenCount")}>{(counts.byLabel.get(label.id) ?? 0).toLocaleString()}</span> : null}
          </Link>
        );
      })}
      {facets.status === "success" && !facets.data.exact ? <p className="rd-issue-facet-note">{t("repositoryIssuesPartialCounts")}</p> : null}
    </nav>
  );
}
