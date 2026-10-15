import { IssueList } from "../../../features/issues/issue-list";
import { IssueDetail } from "../../../features/issues/issue-detail";
import type { IssuePageProps, IssueListPageProps, IssueDetailPageProps } from "../../page.types";
import { PageContent } from "../../../shared/ui";
import { useI18n } from "../../../shared/i18n";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";

/**
 * Both themes render Issues at the same URLs. Repository shows the repository chrome with an
 * Issues tab; Wiki keeps its sidebar and highlights the Issues entry.
 */
export function WikiIssueLayout({ spaceId, crumb, children }: IssuePageProps) {
  const { t } = useI18n();
  return (
    <WorkspaceLayout
      {...(spaceId ? { selectedSpaceId: spaceId } : {})}
      selectedView="issues"
      headerTitle={crumb ? `${t("issues")} · ${crumb}` : t("issues")}
    >
      <PageContent>{children}</PageContent>
    </WorkspaceLayout>
  );
}

export function WikiIssueListPage(props: IssueListPageProps) {
  return (
    <WikiIssueLayout {...(props.spaceId ? { spaceId: props.spaceId } : {})}>
      <IssueList {...props} presentation="standard" />
    </WikiIssueLayout>
  );
}

export function WikiIssueDetailPage(props: IssueDetailPageProps) {
  return (
    <WikiIssueLayout spaceId={props.spaceId} crumb={`#${props.number}`}>
      <IssueDetail {...props} presentation="standard" />
    </WikiIssueLayout>
  );
}
