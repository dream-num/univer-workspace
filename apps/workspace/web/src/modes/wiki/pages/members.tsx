import type { SpaceSettingsPageProps } from "../../page.types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TeamMemberManager } from "../../../features/permissions";
import { spacesQueryOptions } from "../../../features/spaces";
import { useI18n } from "../../../shared/i18n";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "../../workspace-layout";

export function WikiTeamMembersPage({ spaceId }: SpaceSettingsPageProps) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  if (!space || space.type !== "team") return null;
  const manager = (
    <TeamMemberManager
      presentation="standard"
      spaceId={spaceId}
      spaceName={space.name}
      canManage={space.capabilities.manageMembers}
      actorRole={space.accessRole}
      searchQuery={searchQuery}
    />
  );
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      {...{ selectedView: "members" as const }}
      headerTitle={t("members")}
      headerContent={
        <WorkspaceHeaderSearch placeholder={t("searchMembers")} value={searchQuery} onChange={setSearchQuery} />
      }
    >
      {manager}
    </WorkspaceLayout>
  );
}
