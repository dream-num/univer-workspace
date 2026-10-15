import type { IssuePageProps } from "../../page.types";
import { RepositoryPage } from "../../../features/spaces";
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
      <RepositoryPage>{children}</RepositoryPage>
    </WorkspaceLayout>
  );
}
