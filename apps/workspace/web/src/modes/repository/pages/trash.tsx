import type { SpaceSettingsPageProps } from "../../page.types";
import { useState } from "react";
import { TrashList } from "../../../features/trash";
import { RepositorySettingsLayout } from "../repository-settings-layout";
import { useI18n } from "../../../shared/i18n";
import { Input } from "../../../shared/ui";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";

export function RepositorySpaceTrashPage({ spaceId }: SpaceSettingsPageProps) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      {...{
        repositoryTab: "settings" as const,
        repositoryBreadcrumbs: [{ label: t("spaceSettings"), settingsSpaceId: spaceId }, { label: t("trash") }],
      }}
      headerTitle={t("trash")}
      headerContent={undefined}
    >
      {
        <RepositorySettingsLayout spaceId={spaceId} current="trash" title={t("trash")}>
          <Input
            type="search"
            aria-label={t("searchTrash")}
            placeholder={t("searchTrash")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="mb-4 h-8 max-w-sm rounded-[6px]"
          />
          <TrashList presentation="compact" spaceId={spaceId} searchQuery={searchQuery} />
        </RepositorySettingsLayout>
      }
    </WorkspaceLayout>
  );
}
