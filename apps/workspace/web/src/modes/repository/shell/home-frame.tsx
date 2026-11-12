import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookMarked, LockKeyhole, Pin } from "lucide-react";
import { useState, type ReactNode } from "react";
import { mySpacesQueryOptions, spacePinsQueryOptions } from "../../../features/spaces";
import { HomeTools } from "./home-tools";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import type { HomeWork } from "../data";
import { CustomizePinsDialog } from "../customize-pins-dialog";
import { filterRepositories } from "../repository-directory";
import { RepositoryCreateButton, RepositoryQueryState, RepositorySearchField } from "../repository-controls";
import { spaceDisplayName } from "../space-name";

export function HomeFrame({
  children,
  openBySpace,
  updatedBySpace,
}: {
  readonly children: ReactNode;
  readonly updatedBySpace: HomeWork["updatedBySpace"] | undefined;
  readonly openBySpace: HomeWork["openBySpace"] | undefined;
}) {
  return (
    <div className="rd-home">
      <HomeRail openBySpace={openBySpace} updatedBySpace={updatedBySpace} />
      <div className="rd-homemain">{children}</div>
    </div>
  );
}

function HomeRail({ openBySpace, updatedBySpace }: {
  readonly openBySpace: HomeWork["openBySpace"] | undefined;
  readonly updatedBySpace: HomeWork["updatedBySpace"] | undefined;
}) {
  const { t, language } = useI18n();
  const pins = useQuery(spacePinsQueryOptions);
  const [customize, setCustomize] = useState(false);
  const [q, setQ] = useState("");
  const spaces = useQuery({ ...mySpacesQueryOptions, enabled: Boolean(q.trim()) });
  const items = q.trim()
    ? filterRepositories(
        spaces.data?.spaces ?? [],
        { q },
        (space) => spaceDisplayName(space, t) ?? space.name,
        language,
      ).slice(0, 8)
    : (pins.data?.spaces ?? []);
  const list = q.trim() ? spaces : pins;
  return (
    <aside className="rd-rail">
      <section aria-label={t("dashboardMyRepositories")}>
        <div className="rd-rail-h">
          <h2>{t("dashboardMyRepositories")}</h2>
          <div className="rd-rail-actions">
            <RepositoryCreateButton compact />
            <button
              className="rd-iconbtn"
              type="button"
              aria-label={t("repositoryCustomizePins")}
              title={t("repositoryCustomizePins")}
              disabled={!pins.data}
              onClick={() => setCustomize(true)}
            >
              <Pin aria-hidden="true" />
            </button>
          </div>
        </div>
        {customize && pins.data ? (
          <CustomizePinsDialog pins={pins.data} onClose={() => setCustomize(false)} />
        ) : null}
        <RepositorySearchField value={q} onChange={setQ} label={t("searchRepositories")} />
        <RepositoryQueryState
          pending={list.isPending}
          failed={list.isError && !list.data}
          retry={list.refetch}
        >
          <ul className="rd-repo-list">
            {items.map((space) => {
              const open = openBySpace?.get(space.id);
              const updatedAt = updatedBySpace?.get(space.id);
              return (
                <li key={space.id}>
                  <Link to="/spaces/$spaceId" params={{ spaceId: space.id }} search={{}}>
                    <span className="rd-repo-ic">
                      <BookMarked aria-hidden="true" />
                    </span>
                    <span className="rd-rn">
                      <span>{spaceDisplayName(space, t)}</span>
                      {!space.publicRead ? (
                        <LockKeyhole aria-label={t("repositoryVisibilityPrivate")} />
                      ) : null}
                    </span>
                    {open ? (
                      <span className="rd-rf">
                        {t("repositoryHomeOpenCount", { count: open.pulls + open.issues })}
                      </span>
                    ) : (
                      <span className="rd-rf">
                        {updatedAt
                          ? t("repositoryUpdated", { date: formatRelativeDate(updatedAt, language) })
                          : t("repositoryNoActivityMeta")}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {!items.length ? (
            <p className="py-3 text-xs text-muted-foreground">
              {t(q ? "repositoriesNoMatch" : "repositoriesEmpty")}
            </p>
          ) : null}
        </RepositoryQueryState>
        <Link className="rd-all" to="/repositories" search={q ? { q } : {}}>
          {t("dashboardAllRepositories")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </section>
      <HomeTools />
    </aside>
  );
}
