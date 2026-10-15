import type { SpaceSettingsPageProps } from "../../page.types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TeamMemberManager } from "../../../features/permissions";
import { RepositorySettingsLayout, spacesQueryOptions } from "../../../features/spaces";
import { useI18n } from "../../../shared/i18n";
import { Input } from "../../../shared/ui";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";

export function RepositoryTeamMembersPage({ spaceId }: SpaceSettingsPageProps) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  if (!space || space.type !== "team") return null;
  const manager = (
    <TeamMemberManager
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
      {...{
        repositoryTab: "settings" as const,
        repositoryBreadcrumbs: [{ label: t("spaceSettings"), settingsSpaceId: spaceId }, { label: t("members") }],
      }}
      headerTitle={t("members")}
      headerContent={undefined}
    >
      {
        <RepositorySettingsLayout spaceId={spaceId} current="members" title={t("members")}>
          <Input
            type="search"
            aria-label={t("searchMembers")}
            placeholder={t("searchMembers")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="mb-4 h-8 max-w-sm rounded-[6px]"
          />
          {manager}
        </RepositorySettingsLayout>
      }
    </WorkspaceLayout>
  );
}
