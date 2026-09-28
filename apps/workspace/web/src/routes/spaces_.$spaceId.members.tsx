import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  TeamMemberManager,
  teamMembersQueryOptions,
} from "../features/permissions";
import { requireAuthenticatedSession } from "../features/auth";
import { RepositoryTabs, SpaceSettingsNav, spacesQueryOptions } from "../features/spaces";
import { useI18n } from "../shared/i18n";
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";

export const Route = createFileRoute("/spaces_/$spaceId/members")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await Promise.all([
      context.queryClient.ensureQueryData(spacesQueryOptions),
      context.queryClient.ensureQueryData(
        teamMembersQueryOptions(params.spaceId)
      ),
    ]);
  },
  component: TeamMembersPage,
});

function TeamMembersPage() {
  const { spaceId } = Route.useParams();
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  if (!space || space.type !== "team") return null;
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      repositoryTab="settings"
      repositoryBreadcrumbs={[{ label: t("members") }]}
      headerTitle={t("members")}
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchMembers")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      <RepositoryTabs spaceId={spaceId} active="settings" />
      <div className="min-h-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto flex max-w-6xl gap-8 px-6 py-6 max-[720px]:flex-col max-[720px]:gap-4 max-[720px]:px-4 max-[720px]:py-4">
          <SpaceSettingsNav spaceId={spaceId} current="members" />
          <div className="min-w-0 flex-1">
            <TeamMemberManager
              spaceId={spaceId}
              spaceName={space.name}
              canManage={space.capabilities.manageMembers}
              actorRole={space.accessRole}
              searchQuery={searchQuery}
            />
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
