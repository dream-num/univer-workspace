import { RepositoryIssueList } from "../issues/repository-issue-list";
import { IssueDetail } from "../../../features/issues/issue-detail";
import type { IssuePageProps, IssueListPageProps, IssueDetailPageProps } from "../../page.types";
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
      {crumb ? <div className="rd-issue-page">{children}</div> : children}
    </WorkspaceLayout>
  );
}

export function RepositoryIssueListPage(props: IssueListPageProps) {
  return (
    <RepositoryIssueLayout {...(props.spaceId ? { spaceId: props.spaceId } : {})}>
      <RepositoryIssueList {...props} />
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
