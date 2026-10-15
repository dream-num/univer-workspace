import { Route } from "../../../routes/spaces_.$spaceId.members";
import { useQuery } from "@tanstack/react-query";

import { useState } from "react";
import { TeamMemberManager } from "../../../features/permissions";

import { RepositorySettingsLayout, spacesQueryOptions } from "../../../features/spaces";
import { useI18n } from "../../../shared/i18n";
import { useTheme } from "../../../shared/theme";
import { Input } from "../../../shared/ui";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "../../../routes/-workspace-layout";

export function WikiTeamMembersPage() {
  const { spaceId } = Route.useParams();
  const { t } = useI18n();
  const { workspaceTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  if (!space || space.type !== "team") return null;
  const repository = workspaceTheme === "repository";
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
      {...(repository
        ? {
            repositoryTab: "settings" as const,
            repositoryBreadcrumbs: [
              { label: t("spaceSettings"), settingsSpaceId: spaceId },
              { label: t("members") },
            ],
          }
        : { selectedView: "members" as const })}
      headerTitle={t("members")}
      headerContent={
        !repository ? (
          <WorkspaceHeaderSearch
            placeholder={t("searchMembers")}
            value={searchQuery}
            onChange={setSearchQuery}
          />
        ) : undefined
      }
    >
      {repository ? (
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
      ) : (
        manager
      )}
    </WorkspaceLayout>
  );
}
