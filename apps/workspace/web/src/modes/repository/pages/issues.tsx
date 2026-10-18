import { useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "../../../shared/ui";
import { IssueViewsNav } from "./issues/views-nav";
import { IssueList } from "../../../features/issues/issue-list";
import { IssueDetail } from "../../../features/issues/issue-detail";
import type { IssuePageProps, IssueListPageProps, IssueDetailPageProps } from "../../page.types";
import { RepositoryTabs } from "../repository-tabs";
import { useI18n } from "../../../shared/i18n";
import { WorkspaceLayout } from "../../workspace-layout";

/**
 * Both themes render Issues at the same URLs. Repository shows the repository chrome with an
 * Issues tab; Wiki keeps its sidebar and highlights the Issues entry.
 */
export function RepositoryIssueLayout({ spaceId, crumb, children }: IssuePageProps) {
  const { t } = useI18n();
  const title = crumb ?? t("issues");
  return (
    <WorkspaceLayout
      {...(spaceId ? { selectedSpaceId: spaceId } : {})}
      {...(spaceId
        ? {
            repositoryTab: "issues" as const,
            repositoryBreadcrumbs: crumb ? [{ label: t("issues"), issuesSpaceId: spaceId }] : [],
          }
        : { repositoryView: "issues" as const })}
      headerTitle={title}
    >
      {spaceId ? <RepositoryTabs spaceId={spaceId} active="issues" /> : null}
      {spaceId ? (
        <div className="repository-chrome repository-issues min-h-0 flex-1 overflow-y-auto bg-background">
          <div
            className={crumb ? "mx-auto max-w-7xl px-6 py-6 max-[720px]:px-4" : "h-full min-h-0"}
          >
            {children}
          </div>
        </div>
      ) : (
        <div className="repository-global-scroll repository-issues">
          <div className="repository-directory">
            <div className="repository-page-heading">
              <div>
                <h1>{t("issues")}</h1>
                <p>{t("dashboardIssuesHint")}</p>
              </div>
            </div>
            {children}
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}

export function RepositoryIssueListPage(props: IssueListPageProps) {
  const { t } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  return (
    <RepositoryIssueLayout {...(props.spaceId ? { spaceId: props.spaceId } : {})}>
      <IssueList
        {...props}
        presentation={props.spaceId ? "compact" : "standard"}
        filterMenuClassName="repository-chrome repository-issues"
        viewsNav={
          props.spaceId && sidebarOpen ? (
            <IssueViewsNav
              spaceId={props.spaceId}
              filters={props.filters}
              onCollapse={() => setSidebarOpen(false)}
            />
          ) : null
        }
        viewsNavToggle={
          !sidebarOpen ? (
            <Button
              variant="ghost"
              size="icon"
              className="max-[900px]:hidden"
              aria-label={t("issueExpandSidebar")}
              aria-expanded={false}
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftOpen />
            </Button>
          ) : null
        }
      />
    </RepositoryIssueLayout>
  );
}

export function RepositoryIssueDetailPage(props: IssueDetailPageProps) {
  return (
    <RepositoryIssueLayout spaceId={props.spaceId} crumb={`#${props.number}`}>
      <IssueDetail {...props} presentation="compact" />
    </RepositoryIssueLayout>
  );
}
