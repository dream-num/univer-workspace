import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TrashList, trashQueryOptions } from "../features/trash";
import { requireAuthenticatedSession } from "../features/auth";
import { RepositoryTabs, SpaceSettingsNav } from "../features/spaces";
import { useI18n } from "../shared/i18n";
import { useTheme } from "../shared/theme";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "./-workspace-layout";

export const Route = createFileRoute("/spaces_/$spaceId/trash")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await context.queryClient.ensureQueryData(trashQueryOptions(params.spaceId));
  },
  component: SpaceTrashPage,
});

function SpaceTrashPage() {
  const { spaceId } = Route.useParams();
  const { t } = useI18n();
  const { workspaceTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const repository = workspaceTheme === "repository";
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      {...(repository
        ? {
            repositoryTab: "settings" as const,
            repositoryBreadcrumbs: [
              { label: t("spaceSettings"), settingsSpaceId: spaceId },
              { label: t("trash") },
            ],
          }
        : { selectedView: "trash" as const })}
      headerTitle={t("trash")}
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchTrash")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      {repository ? (
        <>
          <RepositoryTabs spaceId={spaceId} active="settings" />
          <div className="min-h-0 flex-1 overflow-y-auto bg-background">
            <div className="mx-auto flex max-w-6xl gap-8 px-6 py-6 max-[720px]:flex-col max-[720px]:gap-4 max-[720px]:px-4 max-[720px]:py-4">
              <SpaceSettingsNav spaceId={spaceId} current="trash" />
              <div className="min-w-0 flex-1">
                <TrashList spaceId={spaceId} searchQuery={searchQuery} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <TrashList spaceId={spaceId} searchQuery={searchQuery} />
      )}
    </WorkspaceLayout>
  );
}
