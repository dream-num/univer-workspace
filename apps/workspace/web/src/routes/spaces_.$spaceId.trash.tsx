import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  TrashList,
  trashQueryOptions,
} from "../features/trash";
import { requireAuthenticatedSession } from "../features/auth";
import { useI18n } from "../shared/i18n";
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";

export const Route = createFileRoute("/spaces_/$spaceId/trash")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await context.queryClient.ensureQueryData(
      trashQueryOptions(params.spaceId)
    );
  },
  component: SpaceTrashPage,
});

function SpaceTrashPage() {
  const { spaceId } = Route.useParams();
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      selectedView="trash"
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchTrash")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      <TrashList spaceId={spaceId} searchQuery={searchQuery} />
    </WorkspaceLayout>
  );
}
