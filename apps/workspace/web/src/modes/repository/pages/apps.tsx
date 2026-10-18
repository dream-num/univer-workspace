import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, Globe } from "lucide-react";
import type { AppsPageProps } from "../../page.types";
import { HtmlAppPage } from "../../html-app-page";
import { appTitle } from "../../../features/html-views/app-tree";
import { htmlViewPagesQueryOptions } from "../../../features/views/html-views.queries";
import { spacesQueryOptions } from "../../../features/spaces";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import { Select } from "../../../shared/ui";
import { WorkspaceLayout } from "../../workspace-layout";
import {
  RepositoryLoadMore,
  RepositoryQueryState,
  RepositorySearchField,
} from "../repository-controls";
import { spaceDisplayName } from "../space-name";

export function RepositoryAppsPage(props: AppsPageProps) {
  return props.node ? <HtmlAppPage {...props} /> : <RepositoryPagesDirectory {...props} />;
}

function RepositoryPagesDirectory({ spaceId, q = "" }: AppsPageProps) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const query = useInfiniteQuery(htmlViewPagesQueryOptions(spaceId));
  const spaces = useQuery(spacesQueryOptions);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const term = q.trim().toLocaleLowerCase(language);
  const visible = items.filter((item) =>
    [item.node.name, spaceDisplayName(item.location.space, t)].some((value) =>
      value?.toLocaleLowerCase(language).includes(term),
    ),
  );
  const filters = { ...(spaceId ? { spaceId } : {}), ...(q ? { q } : {}) };
  return (
    <WorkspaceLayout repositoryView="apps" headerTitle={t("pages")}>
      <div className="repository-global-scroll">
        <div className="repository-directory">
          <div className="repository-page-heading">
            <div>
              <h1>{t("pages")}</h1>
              <p>{t("dashboardPagesHint")}</p>
            </div>
          </div>
          <div className="repository-toolbar">
            <RepositorySearchField
              value={q}
              onChange={(value) =>
                void navigate({ to: "/apps", search: { ...filters, q: value }, replace: true })
              }
              label={t("dashboardSearchLoaded")}
            />
            <Select
              aria-label={t("belongingSpace")}
              value={spaceId ?? "all"}
              onValueChange={(value) =>
                void navigate({
                  to: "/apps",
                  search: { ...(q ? { q } : {}), ...(value === "all" ? {} : { spaceId: value }) },
                  replace: true,
                })
              }
              options={[
                { value: "all", label: t("allSpaces") },
                ...(spaces.data?.spaces.map((space) => ({
                  value: space.id,
                  label: spaceDisplayName(space, t) ?? space.name,
                })) ?? []),
              ]}
            />
          </div>
          <div className="repository-panel">
            <div className="repository-panel-heading">
              <h2>{t("pages")}</h2>
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
                <ul className="repository-rows">
                  {visible.map((item) => (
                    <li key={item.node.id}>
                      <Globe
                        aria-hidden="true"
                        className="mt-1 size-5 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/apps"
                          search={{ ...filters, node: item.node.id }}
                          className="repository-row-title"
                        >
                          {appTitle(item.node.name)}
                        </Link>
                        <div className="repository-row-meta">
                          <span>{spaceDisplayName(item.location.space, t)}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={item.node.updatedAt}>
                            {formatRelativeDate(item.node.updatedAt, language)}
                          </time>
                        </div>
                        <p className="mt-2 break-all text-xs text-muted-foreground">
                          {item.node.name}
                        </p>
                      </div>
                      <Link
                        to="/nodes/$nodeId"
                        params={{ nodeId: item.node.id }}
                        search={{ view: "immersive" }}
                        className="repository-secondary-link"
                        aria-label={`${t("repositoryOpenPage")}: ${appTitle(item.node.name)}`}
                      >
                        <ExternalLink aria-hidden="true" />
                        <span className="max-[720px]:hidden">{t("repositoryOpenPage")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="repository-empty">
                  <Globe aria-hidden="true" />
                  <h2>{t(q ? "noMatchingResources" : "appsEmpty")}</h2>
                  {!q ? <p className="max-w-lg leading-6">{t("appsEmptyHint")}</p> : null}
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
