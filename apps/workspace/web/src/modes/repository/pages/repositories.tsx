import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookMarked, LockKeyhole } from "lucide-react";
import { spacesQueryOptions } from "../../../features/spaces";
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
import { spaceDisplayName } from "../space-name";

const roleKeys = {
  owner: "accessOwner",
  admin: "accessAdmin",
  editor: "accessEditor",
  viewer: "accessViewer",
} as const satisfies Record<string, MessageKey>;

export function RepositoryDirectoryPage(props: RepositorySearch) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const spaces = useQuery(spacesQueryOptions);
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
                  onClick={() => void navigate({ to: "/repositories", search: {}, replace: true })}
                >
                  {t("clearFilters")}
                </Button>
              ) : null}
            </div>
            {items.length ? (
              <ul className="repository-directory-list">
                {items.map((space) => (
                  <li key={space.id}>
                    {space.publicRead ? (
                      <BookMarked aria-hidden="true" />
                    ) : (
                      <LockKeyhole aria-hidden="true" />
                    )}
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
                        <span className="repository-label">
                          {t(
                            space.type === "personal"
                              ? "repositoryVisibilityPersonal"
                              : space.publicRead
                                ? "repositoryVisibilityPublic"
                                : "repositoryVisibilityPrivate",
                          )}
                        </span>
                      </div>
                      {space.description ? (
                        <p className="mt-2 line-clamp-2 max-w-3xl text-sm text-muted-foreground">
                          {space.description}
                        </p>
                      ) : null}
                      <p className="mt-3 text-xs text-muted-foreground">
                        {t(space.type === "personal" ? "personalSpace" : "teamSpace")}
                        {" · "}
                        {t(roleKeys[space.accessRole])}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="repository-empty">
                <BookMarked aria-hidden="true" />
                <h2>{t(filtered ? "repositoriesNoMatch" : "repositoriesEmpty")}</h2>
                {filtered ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void navigate({ to: "/repositories", search: {}, replace: true })
                    }
                  >
                    {t("clearFilters")}
                  </Button>
                ) : (
                  <RepositoryCreateButton />
                )}
              </div>
            )}
          </RepositoryQueryState>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
