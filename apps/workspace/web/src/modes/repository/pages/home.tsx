import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookMarked, ChevronRight, ExternalLink, Terminal } from "lucide-react";
import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import type { HomePageProps } from "../../page.types";
import { sessionQueryOptions } from "../../../features/auth";
import { spacesQueryOptions } from "../../../features/spaces";
import { recentResourceSummaryQueryOptions } from "../../../features/views/recent.queries";
import { worktreeSummaryQueryOptions } from "../../../features/worktrees/worktrees.queries";
import { issueSummaryQueryOptions } from "../../../features/issues/issues.queries";
import { CLI_GUIDE_URL } from "../../../features/worktrees/worktree-onboarding";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import { WorkspaceLayout } from "../../workspace-layout";
import { RepositoryCreateButton, RepositoryQueryState } from "../repository-controls";
import {
  RepositoryIssueRows,
  RepositoryResourceIcon,
  RepositoryResourceRows,
  RepositoryWorktreeRows,
} from "../repository-summary-rows";
import { spaceDisplayName } from "../space-name";

export function RepositoryHomePage(_props: HomePageProps) {
  const { t, language } = useI18n();
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery(spacesQueryOptions);
  const recent = useQuery(recentResourceSummaryQueryOptions);
  const prs = useQuery(worktreeSummaryQueryOptions);
  const issues = useQuery(issueSummaryQueryOptions);
  const resources = recent.data?.items ?? [];
  const recentFiles = resources.filter(
    (item) => !(item.resource.kind === "blob" && isHtmlViewFilename(item.node.name)),
  );
  const tasks = prs.data?.items ?? [];
  const openIssues = issues.data?.items ?? [];
  const personal = spaces.data?.spaces.find(
    (space) => space.type === "personal" && space.accessRole === "owner",
  );
  const newUser =
    recent.isSuccess &&
    resources.length === 0 &&
    prs.isSuccess &&
    !prs.data.hasCreatedWorktree &&
    tasks.length === 0 &&
    issues.isSuccess &&
    openIssues.length === 0;
  return (
    <WorkspaceLayout repositoryView="home" selectedView="home" headerTitle={t("home")}>
      <div className="repository-global-scroll">
        <div className="repository-dashboard">
          <div className="repository-dashboard-main">
            <div className="repository-page-heading">
              <div>
                <h1>{t("home")}</h1>
                <p>
                  {t("dashboardGreeting", {
                    name: session.data?.authenticated ? session.data.user.displayName : "",
                  })}
                </p>
              </div>
            </div>
            {newUser ? (
              <section className="repository-guide">
                <BookMarked aria-hidden="true" className="mb-4 size-6 text-muted-foreground" />
                <h2>{t("dashboardWelcome")}</h2>
                <p>{t("dashboardWelcomeDescription")}</p>
                <div className="flex flex-wrap gap-3">
                  <RepositoryCreateButton />
                  {personal ? (
                    <Link
                      className="repository-secondary-link"
                      to="/spaces/$spaceId"
                      params={{ spaceId: personal.id }}
                      search={{}}
                    >
                      {t("dashboardOpenPersonal")}
                    </Link>
                  ) : null}
                </div>
              </section>
            ) : null}
            <section aria-labelledby="dashboard-recent-title">
              <div className="repository-section-heading">
                <h2 id="dashboard-recent-title">{t("dashboardContinue")}</h2>
                <Link to="/recent" search={{}} className="flex items-center gap-1">
                  {t("recent")}
                  <ChevronRight aria-hidden="true" />
                </Link>
              </div>
              <RepositoryQueryState
                pending={recent.isPending}
                failed={recent.isError && !recent.data}
                retry={recent.refetch}
              >
                {recentFiles.length ? (
                  <div className="repository-resume">
                    {recentFiles.slice(0, 2).map((item) => (
                      <Link
                        key={item.resource.id}
                        to="/nodes/$nodeId"
                        params={{ nodeId: item.node.id }}
                        search={{}}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <RepositoryResourceIcon item={item} />
                          <div className="min-w-0">
                            <p className="repository-row-title line-clamp-2">{item.node.name}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {spaceDisplayName(item.location.space, t)}
                            </p>
                          </div>
                        </div>
                        <time
                          dateTime={item.lastOpenedAt}
                          className="text-xs text-muted-foreground"
                        >
                          {t("lastOpened")} · {formatRelativeDate(item.lastOpenedAt, language)}
                        </time>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="repository-panel">
                    <p className="p-5 text-sm leading-6 text-muted-foreground">
                      {t("dashboardNoRecent")}
                    </p>
                  </div>
                )}
              </RepositoryQueryState>
            </section>
            <section aria-labelledby="dashboard-pr-title">
              <div className="repository-section-heading">
                <h2 id="dashboard-pr-title">{t("repositoryPullRequests")}</h2>
                <Link to="/worktrees" search={{}} className="flex items-center gap-1">
                  {t("viewAll")}
                  <ChevronRight aria-hidden="true" />
                </Link>
              </div>
              <div className="repository-panel">
                <RepositoryQueryState
                  pending={prs.isPending}
                  failed={prs.isError && !prs.data}
                  retry={prs.refetch}
                >
                  {tasks.length ? (
                    <RepositoryWorktreeRows items={tasks.slice(0, 5)} />
                  ) : (
                    <p className="p-5 text-sm leading-6 text-muted-foreground">
                      {t("dashboardNoPullRequests")}
                    </p>
                  )}
                </RepositoryQueryState>
              </div>
            </section>
            <section aria-labelledby="dashboard-issues-title">
              <div className="repository-section-heading">
                <h2 id="dashboard-issues-title">{t("issues")}</h2>
                <Link to="/issues" search={{ sort: "updated" }} className="flex items-center gap-1">
                  {t("viewAll")}
                  <ChevronRight aria-hidden="true" />
                </Link>
              </div>
              <div className="repository-panel">
                <RepositoryQueryState
                  pending={issues.isPending}
                  failed={issues.isError && !issues.data}
                  retry={issues.refetch}
                >
                  {openIssues.length ? (
                    <RepositoryIssueRows items={openIssues.slice(0, 5)} />
                  ) : (
                    <p className="p-5 text-sm leading-6 text-muted-foreground">
                      {t("dashboardNoIssues")}
                    </p>
                  )}
                </RepositoryQueryState>
              </div>
            </section>
            <footer className="repository-global-footer">
              OfficeLab ·{" "}
              <a
                className="hover:underline"
                href="https://github.com/dream-num/univer-workspace"
                target="_blank"
                rel="noopener noreferrer"
              >
                Univer Workspace
              </a>
            </footer>
          </div>
          <aside className="repository-dashboard-aside">
            {recentFiles.length > 2 ? (
              <section>
                <div className="repository-section-heading">
                  <h2>{t("dashboardRecentFiles")}</h2>
                </div>
                <RepositoryResourceRows items={recentFiles.slice(2, 5)} />
              </section>
            ) : null}
            <section className="repository-guide">
              <Terminal aria-hidden="true" className="mb-3 size-5 text-muted-foreground" />
              <h2>{t("dashboardCliTitle")}</h2>
              <p>{t("dashboardCliDescription")}</p>
              <a
                className="repository-secondary-link"
                href={CLI_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("onboardingCliLink")}
                <ExternalLink aria-hidden="true" />
              </a>
            </section>
          </aside>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
