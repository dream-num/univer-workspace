import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  TeamMemberManager,
  teamMembersQueryOptions,
} from "../features/permissions";
import { requireAuthenticatedSession } from "../features/auth";
import { spacesQueryOptions } from "../features/spaces";
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
      selectedView="members"
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchMembers")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      <TeamMemberManager
        spaceId={spaceId}
        spaceName={space.name}
        canManage={space.capabilities.manageMembers}
        actorRole={space.accessRole}
        searchQuery={searchQuery}
      />
    </WorkspaceLayout>
  );
}
