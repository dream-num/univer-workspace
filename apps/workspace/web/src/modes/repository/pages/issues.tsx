import type { IssuePageProps } from "../../page.types";
import { RepositoryPage, RepositoryTabs } from "../../../features/spaces";
import { useI18n } from "../../../shared/i18n";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";

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
        : { repositoryHome: true })}
      headerTitle={title}
    >
      {spaceId ? <RepositoryTabs spaceId={spaceId} active="issues" /> : null}
      {spaceId ? (
        <div className="repository-chrome repository-issues min-h-0 flex-1 overflow-y-auto bg-background">
          <div className={crumb ? "mx-auto max-w-7xl px-6 py-6 max-[720px]:px-4" : "min-h-full"}>{children}</div>
        </div>
      ) : (
        <RepositoryPage>{children}</RepositoryPage>
      )}
    </WorkspaceLayout>
  );
}
