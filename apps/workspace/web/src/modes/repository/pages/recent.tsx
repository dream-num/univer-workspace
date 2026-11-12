import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { loadAgentsUi } from "../../../features/agents";
import { CurrentLink } from "../current-link";
import { Clock3 } from "lucide-react";
import type { RecentPageProps } from "../../page.types";
import { recentResourcePagesQueryOptions } from "../../../features/views/recent.queries";
import { useI18n } from "../../../shared/i18n";
import { WorkspaceLayout } from "../../workspace-layout";
import {
  RepositoryLoadMore,
  RepositoryQueryState,
  RepositorySearchField,
} from "../repository-controls";
import { RepositoryResourceRows } from "../repository-summary-rows";
import { spaceDisplayName } from "../space-name";

const RecentSessions = lazy(() => loadAgentsUi().then((ui) => ({ default: ui.RecentAgentSessions })));

export function RepositoryRecentPage({ q = "", tab }: RecentPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return <WorkspaceLayout repositoryView="recent" headerTitle={t("recent")}>
    <div className="repository-global-scroll"><div className="repository-directory">
      <div className="repository-page-heading"><div><h1>{t("recent")}</h1><p>{t("repositoryRecentHint")}</p></div></div>
      <nav className="rd-directory-tabs" aria-label={t("recent")}>
        <CurrentLink to="/recent" search={q ? { q } : {}} current={!tab}>{t("repositoryFiles")}</CurrentLink>
        <CurrentLink to="/recent" search={{ ...(q ? { q } : {}), tab: "sessions" }} current={tab === "sessions"}>
          {t("repositoryAgentSessions")}
        </CurrentLink>
      </nav>
      <div className="repository-toolbar"><RepositorySearchField value={q} label={t("dashboardSearchLoaded")}
        onChange={(value) => void navigate({ to: "/recent", search: { ...(value ? { q: value } : {}), ...(tab ? { tab } : {}) }, replace: true })} /></div>
      {tab === "sessions" ? <Suspense fallback={<p role="status">{t("dashboardLoading")}</p>}><RecentSessions q={q} /></Suspense> : <RecentFiles q={q} />}
    </div></div>
  </WorkspaceLayout>;
}

function RecentFiles({ q }: { readonly q: string }) {
  const { t, language } = useI18n();
  const query = useInfiniteQuery(recentResourcePagesQueryOptions);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const term = q.trim().toLocaleLowerCase(language);
  const visible = items.filter((item) =>
    [
      item.node.name,
      spaceDisplayName(item.location.space, t),
      ...item.location.breadcrumbs.map((b) => b.name),
    ].some((value) => value?.toLocaleLowerCase(language).includes(term)),
  );
  return (
    <>
      <div className="repository-panel">
        <div className="repository-panel-heading">
          <h2>{t("name")}</h2>
          <span className="text-xs text-muted-foreground">
            {query.hasNextPage ? t("repositoryMoreItemsAvailable") : ""}
          </span>
        </div>
        <RepositoryQueryState
          pending={query.isPending}
          failed={query.isError && !query.data}
          retry={query.refetch}
        >
          {visible.length ? (
            <RepositoryResourceRows items={visible} />
          ) : (
            <div className="repository-empty">
              <Clock3 aria-hidden="true" />
              <p>{t(q ? "noMatchingResources" : "dashboardNoRecent")}</p>
            </div>
          )}
        </RepositoryQueryState>
      </div>
      <RepositoryLoadMore
        hasNext={query.hasNextPage}
        pending={query.isFetchingNextPage}
        failed={query.isFetchNextPageError}
        load={query.fetchNextPage}
      />
    </>
  );
}
