import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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

export function RepositoryRecentPage({ q = "" }: RecentPageProps) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
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
    <WorkspaceLayout repositoryView="recent" headerTitle={t("recent")}>
      <div className="repository-global-scroll">
        <div className="repository-directory">
          <div className="repository-page-heading">
            <div>
              <h1>{t("recent")}</h1>
              <p>{t("dashboardRecentHint")}</p>
            </div>
          </div>
          <div className="repository-toolbar">
            <RepositorySearchField
              value={q}
              onChange={(value) =>
                void navigate({ to: "/recent", search: value ? { q: value } : {}, replace: true })
              }
              label={t("dashboardSearchLoaded")}
            />
          </div>
          <div className="repository-panel">
            <div className="repository-panel-heading">
              <h2>{t("name")}</h2>
              <span className="text-xs text-muted-foreground">
                {query.data ? t("dashboardLoaded", { count: items.length }) : ""}
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
        </div>
      </div>
    </WorkspaceLayout>
  );
}
