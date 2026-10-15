import type { SpaceSettingsPageProps } from "../../page.types";
import { useState } from "react";
import { TrashList } from "../../../features/trash";
import { useI18n } from "../../../shared/i18n";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "../../../routes/-workspace-layout";

export function WikiSpaceTrashPage({ spaceId }: SpaceSettingsPageProps) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      {...{ selectedView: "trash" as const }}
      headerTitle={t("trash")}
      headerContent={
        <WorkspaceHeaderSearch placeholder={t("searchTrash")} value={searchQuery} onChange={setSearchQuery} />
      }
    >
      {<TrashList spaceId={spaceId} searchQuery={searchQuery} />}
    </WorkspaceLayout>
  );
}
