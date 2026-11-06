import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookMarked } from "lucide-react";
import { mySpacesQueryOptions, starredSpacesQueryOptions, exploreSpacesQueryOptions } from "../../../features/spaces";
import { useI18n, type MessageKey } from "../../../shared/i18n";
import { Button, Select } from "../../../shared/ui";
import { WorkspaceLayout } from "../../workspace-layout";
import {
  filterRepositories,
  parseRepositorySearch,
  type RepositorySearch,
} from "../repository-directory";
import {
  RepositoryCreateButton,
  RepositoryQueryState,
  RepositorySearchField,
} from "../repository-controls";
import { CurrentLink } from "../current-link";
import { RepositoryStar } from "../repository-star";
import { spaceDisplayName } from "../space-name";

const roleKeys = {
  owner: "accessOwner",
  member: "repositoryAffiliationMember",
  none: "repositoryVisibilityPublic",
} as const satisfies Record<string, MessageKey>;

export function RepositoryDirectoryPage(props: RepositorySearch) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const mine = useQuery({ ...mySpacesQueryOptions, enabled: props.view === undefined });
  const starred = useQuery({ ...starredSpacesQueryOptions, enabled: props.view === "starred" });
  const explore = useQuery({ ...exploreSpacesQueryOptions, enabled: props.view === "explore" });
  const spaces = props.view === "starred" ? starred : props.view === "explore" ? explore : mine;
  const update = (patch: { [K in keyof RepositorySearch]?: RepositorySearch[K] | undefined }) =>
    void navigate({
      to: "/repositories",
      search: parseRepositorySearch({ ...props, ...patch }),
      replace: true,
    });
  const items = filterRepositories(
    spaces.data?.spaces ?? [],
    props,
    (space) => spaceDisplayName(space, t) ?? space.name,
    language,
  );
  const filtered = Boolean(props.q || props.type || props.visibility || props.sort);
  return (
    <WorkspaceLayout repositoryView="repositories" headerTitle={t("allSpaces")}>
      <div className="repository-global-scroll">
        <div className="repository-directory">
          <div className="repository-page-heading">
            <div>
              <h1>{t("allSpaces")}</h1>
              <p>{t("dashboardRepositoriesHint")}</p>
            </div>
            <RepositoryCreateButton />
          </div>
          <nav className="rd-directory-tabs" aria-label={t("allSpaces")}>
            {([
              { view: undefined, label: "repositoryYours" },
              { view: "starred", label: "repositoryStarred" },
              { view: "explore", label: "repositoryExplore" },
             ] satisfies readonly { view: RepositorySearch["view"]; label: MessageKey }[]).map(({ view, label }) => (
              <CurrentLink key={label} to="/repositories" search={view ? { view } : {}} current={props.view === view}>
                {t(label)}
              </CurrentLink>
            ))}
          </nav>
          <div className="repository-toolbar">
            <RepositorySearchField
              value={props.q ?? ""}
              onChange={(q) => update({ q })}
              label={t("dashboardRepositorySearch")}
            />
            <Select
              aria-label={t("repositoryType")}
              value={props.type ?? "all"}
              onValueChange={(value) => update({ type: value === "all" ? undefined : value })}
              options={[
                { value: "all", label: t("allTypes") },
                { value: "personal", label: t("personalSpace") },
                { value: "team", label: t("teamSpace") },
              ]}
            />
            <Select
              aria-label={t("dashboardVisibility")}
              value={props.visibility ?? "all"}
              onValueChange={(value) => update({ visibility: value === "all" ? undefined : value })}
              options={[
                { value: "all", label: t("dashboardVisibility") },
                { value: "public", label: t("repositoryVisibilityPublic") },
                { value: "private", label: t("repositoryVisibilityPrivate") },
              ]}
            />
            <Select
              aria-label={t("dashboardSort")}
              value={props.sort ?? "asc"}
              onValueChange={(value) => update({ sort: value === "desc" ? value : undefined })}
              options={[
                { value: "asc", label: t("dashboardNameAsc") },
                { value: "desc", label: t("dashboardNameDesc") },
              ]}
            />
          </div>
          <RepositoryQueryState
            pending={spaces.isPending}
            failed={spaces.isError && !spaces.data}
            retry={spaces.refetch}
          >
            <div className="repository-results" aria-live="polite">
              <span>{t("dashboardResults", { count: items.length })}</span>
              {filtered ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void navigate({ to: "/repositories", search: props.view ? { view: props.view } : {}, replace: true })}
                >
                  {t("clearFilters")}
                </Button>
              ) : null}
            </div>
            {items.length ? (
              <ul className="repository-directory-list">
                {items.map((space) => (
                  <li key={space.id}>
                    <span className="rd-repo-ic">
                      <BookMarked aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/spaces/$spaceId"
                          params={{ spaceId: space.id }}
                          search={{}}
                          className="repository-name-link"
                        >
                          {space.type === "team" ? (
                            <span className="font-normal">{space.owner.username} / </span>
                          ) : null}
                          {spaceDisplayName(space, t)}
                        </Link>
                      </div>
                      {space.description ? (
                        <p className="mt-2 line-clamp-2 max-w-3xl text-sm text-muted-foreground">
                          {space.description}
                        </p>
                      ) : null}
                      <p className="repository-row-meta mt-3">
                        <span className="repository-label">
                          {t(
                            space.type === "personal"
                              ? "repositoryVisibilityPersonal"
                              : space.publicRead
                                ? "repositoryVisibilityPublic"
                                : "repositoryVisibilityPrivate",
                          )}
                        </span>
                        {space.type === "team" ? <span>{t("teamSpace")}</span> : null}
                        <span>{t(roleKeys[space.affiliation])}</span>
                      </p>
                    </div>
                    <RepositoryStar showCount spaceId={space.id} name={spaceDisplayName(space, t) ?? space.name} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="repository-empty">
                <BookMarked aria-hidden="true" />
                <h2>{t(filtered ? "repositoriesNoMatch" : props.view === "starred" ? "repositoryStarredEmpty" : props.view === "explore" ? "repositoryExploreEmpty" : "repositoriesEmpty")}</h2>
                {filtered ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void navigate({ to: "/repositories", search: props.view ? { view: props.view } : {}, replace: true })
                    }
                  >
                    {t("clearFilters")}
                  </Button>
                ) : !props.view ? (
                  <RepositoryCreateButton />
                ) : null}
              </div>
            )}
          </RepositoryQueryState>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
