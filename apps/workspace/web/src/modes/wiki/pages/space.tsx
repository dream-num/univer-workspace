import type { SpacePageProps } from "../../page.types";
import { Settings, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { NodeBrowser, spaceNodesQueryOptions } from "../../../features/nodes";
import { sessionQueryOptions } from "../../../features/auth";
import { spacesQueryOptions } from "../../../features/spaces";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";
import { useI18n } from "../../../shared/i18n";
import { Button } from "../../../shared/ui";

export function WikiSpacePage({ spaceId }: SpacePageProps) {
  const query = useQuery(spaceNodesQueryOptions(spaceId));
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery({
    ...spacesQueryOptions,
    enabled: session.data?.authenticated === true,
  });
  const navigate = useNavigate();
  const { t } = useI18n();
  const space = session.data?.authenticated ? spaces.data?.spaces.find((item) => item.id === spaceId) : undefined;
  if (!query.data) return null;
  // Wiki mode keeps its Space management entry points; repository mode reaches
  // the same pages through the repository tabs.
  const wikiPageActions =
    space?.type === "team" || space?.capabilities.renameSpace ? (
      <>
        {space?.type === "team" ? (
          <Button
            variant="secondary"
            onClick={() => void navigate({ to: "/spaces/$spaceId/members", params: { spaceId } })}
          >
            <Users />
            {t("members")}
          </Button>
        ) : null}
        {space?.capabilities.renameSpace ? (
          <Button
            variant="secondary"
            onClick={() => void navigate({ to: "/spaces/$spaceId/settings", params: { spaceId } })}
          >
            <Settings />
            {t("spaceSettings")}
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <WorkspaceLayout selectedSpaceId={spaceId}>
      {
        <NodeBrowser
          page={query.data}
          canCreateAtRoot={space?.capabilities.createAtRoot ?? false}
          actions={wikiPageActions}
        />
      }
    </WorkspaceLayout>
  );
}
