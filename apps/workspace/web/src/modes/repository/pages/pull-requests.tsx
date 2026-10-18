import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GitPullRequest, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { spacesQueryOptions } from "../../../features/spaces";
import {
  worktreePagesQueryOptions,
  type WorktreeListFilters,
} from "../../../features/worktrees/worktrees.queries";
import { parseWorktreeDashboardSearch } from "../../../features/worktrees/worktree-review-search";
import { useI18n } from "../../../shared/i18n";
import { Button, Select } from "../../../shared/ui";
import { WorkspaceLayout } from "../../workspace-layout";
import {
  RepositoryLoadMore,
  RepositoryQueryState,
  RepositorySearchField,
} from "../repository-controls";
import { RepositoryWorktreeRows } from "../repository-summary-rows";

export function RepositoryPullRequestsPage(props: WorktreeListFilters) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState(props.q ?? "");
  useEffect(() => setSearch(props.q ?? ""), [props.q]);
  const filters: WorktreeListFilters = {
    ...(props.scope ? { scope: props.scope } : {}),
    ...(props.q ? { q: props.q } : {}),
    ...(props.kind ? { kind: props.kind } : {}),
    ...(props.teamSpaceId ? { teamSpaceId: props.teamSpaceId } : {}),
  };
  const query = useInfiniteQuery(worktreePagesQueryOptions(filters));
  const spaces = useQuery(spacesQueryOptions);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const update = (patch: {
    [K in keyof WorktreeListFilters]?: WorktreeListFilters[K] | undefined;
  }) =>
    void navigate({
      to: "/worktrees",
      search: parseWorktreeDashboardSearch({ ...filters, ...patch }),
      replace: true,
    });
  const filtered = Boolean(props.q || props.kind || props.teamSpaceId);
  return (
    <WorkspaceLayout repositoryView="worktrees" headerTitle={t("repositoryPullRequests")}>
      <div className="repository-global-scroll">
        <div className="repository-directory">
          <div className="repository-page-heading">
            <div>
              <h1>{t("repositoryAllPullRequests")}</h1>
              <p>{t("dashboardLatestPr")}</p>
            </div>
          </div>
          <form
            className="repository-toolbar"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              update({ q: search.trim() || undefined });
            }}
          >
            <RepositorySearchField
              value={search}
              onChange={setSearch}
              label={t("repositorySearchPullRequests")}
            />
            <Button
              type="submit"
              variant="secondary"
              aria-label={t("repositorySearchPullRequests")}
            >
              <Search aria-hidden="true" />
            </Button>
            <Select
              aria-label={t("repositoryType")}
              value={props.kind ?? "all"}
              onValueChange={(value) =>
                update({ kind: value === "all" ? undefined : value, teamSpaceId: undefined })
              }
              options={[
                { value: "all", label: t("allTypes") },
                { value: "user", label: t("personalSpace") },
                { value: "team", label: t("teamSpace") },
              ]}
            />
            <Select
              aria-label={t("belongingSpace")}
              value={props.teamSpaceId ?? "all"}
              onValueChange={(value) =>
                update({
                  teamSpaceId: value === "all" ? undefined : value,
                  kind: value === "all" ? undefined : "team",
                })
              }
              options={[
                { value: "all", label: t("allSpaces") },
                ...(spaces.data?.spaces
                  .filter((s) => s.type === "team")
                  .map((s) => ({ value: s.id, label: s.name })) ?? []),
              ]}
            />
          </form>
          {filtered ? (
            <div className="mb-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  update({ q: undefined, kind: undefined, teamSpaceId: undefined });
                }}
              >
                {t("clearFilters")}
              </Button>
            </div>
          ) : null}
          <div className="repository-panel">
            <div className="repository-panel-heading">
              <div className="flex gap-5">
                {(["active", "processed"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    aria-pressed={(props.scope ?? "active") === scope}
                    className={
                      (props.scope ?? "active") === scope
                        ? "font-semibold"
                        : "text-muted-foreground"
                    }
                    onClick={() => update({ scope })}
                  >
                    {t(
                      scope === "active"
                        ? "repositoryPullRequestsOpen"
                        : "repositoryPullRequestsClosed",
                    )}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {query.data ? t("dashboardLoaded", { count: items.length }) : ""}
              </span>
            </div>
            <RepositoryQueryState
              pending={query.isPending}
              failed={query.isError && !query.data}
              retry={query.refetch}
            >
              {items.length ? (
                <RepositoryWorktreeRows items={items} filters={filters} />
              ) : (
                <div className="repository-empty">
                  <GitPullRequest aria-hidden="true" />
                  <h2>
                    {t(
                      filtered
                        ? "repositoryNoMatchingPullRequests"
                        : props.scope === "processed"
                          ? "dashboardNoProcessed"
                          : "dashboardNoPullRequests",
                    )}
                  </h2>
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
