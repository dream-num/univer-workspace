import type { PropsWithChildren } from "react";
import { RepositoryPage, RepositoryTabs } from "../../../features/spaces";
import { useI18n } from "../../../shared/i18n";
import { useTheme } from "../../../shared/theme";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";

/**
 * Both themes render Issues at the same URLs. Repository shows the repository chrome with an
 * Issues tab; Wiki keeps its sidebar and highlights the Issues entry.
 */
export function RepositoryIssueLayout({
  spaceId,
  crumb,
  children,
}: PropsWithChildren<{
  /** Omit for the cross-Space list. */
  readonly spaceId?: string;
  /** The current page below the Issue list, e.g. `#12`. */
  readonly crumb?: string;
}>) {
  const { t } = useI18n();
  const { workspaceTheme } = useTheme();
  const repository = workspaceTheme === "repository";
  const title = crumb ?? t("issues");
  return (
    <WorkspaceLayout
      {...(spaceId ? { selectedSpaceId: spaceId } : {})}
      {...(repository
        ? spaceId
          ? {
              repositoryTab: "issues" as const,
              repositoryBreadcrumbs: crumb ? [{ label: t("issues"), issuesSpaceId: spaceId }] : [],
            }
          : { repositoryHome: true }
        : { selectedView: "issues" as const })}
      headerTitle={repository ? title : crumb ? `${t("issues")} · ${crumb}` : t("issues")}
    >
      {repository && spaceId ? <RepositoryTabs spaceId={spaceId} active="issues" /> : null}
      {repository && spaceId ? (
        <div className="repository-chrome repository-issues min-h-0 flex-1 overflow-y-auto bg-background">
          <div className={crumb ? "mx-auto max-w-7xl px-6 py-6 max-[720px]:px-4" : "min-h-full"}>
            {children}
          </div>
        </div>
      ) : (
        <RepositoryPage>{children}</RepositoryPage>
      )}
    </WorkspaceLayout>
  );
}
