import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TrashList, trashQueryOptions } from "../features/trash";
import { requireAuthenticatedSession } from "../features/auth";
import { RepositorySettingsLayout } from "../features/spaces";
import { useI18n } from "../shared/i18n";
import { useTheme } from "../shared/theme";
import { Input } from "../shared/ui";
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
        !repository ? (
          <WorkspaceHeaderSearch
            placeholder={t("searchTrash")}
            value={searchQuery}
            onChange={setSearchQuery}
          />
        ) : undefined
      }
    >
      {repository ? (
        <RepositorySettingsLayout spaceId={spaceId} current="trash" title={t("trash")}>
          <Input
            type="search"
            aria-label={t("searchTrash")}
            placeholder={t("searchTrash")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="mb-4 h-8 max-w-sm rounded-[6px]"
          />
          <TrashList spaceId={spaceId} searchQuery={searchQuery} />
        </RepositorySettingsLayout>
      ) : (
        <TrashList spaceId={spaceId} searchQuery={searchQuery} />
      )}
    </WorkspaceLayout>
  );
}
