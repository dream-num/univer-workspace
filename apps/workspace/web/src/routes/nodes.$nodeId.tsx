import { useModeDefinition } from "../modes/registry";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type { IMember } from "@univerjs/protocol";
import {
  invalidateProductLists,
  ResourceActions,
  ResourceUnavailablePage,
  isResourceUnavailableError,
  nodeChildrenQueryOptions,
  nodeQueryOptions,
} from "../features/nodes";
import { anonymousUser, sessionQueryOptions } from "../features/auth";
import { resourceOpenQueryOptions } from "../features/resources";
import { spacesQueryOptions } from "../features/spaces";
import { WorkspaceLayout } from "./-workspace-layout";
import { ResourceEditor } from "../features/editor";
import { BlobPreview } from "../features/blobs";
import { api } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { parseResourceView } from "../features/resource-view/resource-view";
export const Route = createFileRoute("/nodes/$nodeId")({
  validateSearch: (search: Readonly<Record<string, unknown>>): { unit?: string; view?: "immersive" | undefined } => ({
    ...(parseResourceView(search.view) ? { view: "immersive" as const } : {}),
    ...(typeof search.unit === "string" && search.unit ? { unit: search.unit } : {}),
  }),
  loaderDeps: ({ search }) => ({ unit: search.unit }),
  loader: async ({ context, deps, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (deps.unit) {
      const { data } = await api.GET("/api/unit-resources/{unitId}", {
        params: { path: { unitId: deps.unit } },
      });
      if (data) {
        await invalidateProductLists(context.queryClient);
        throw redirect({
          to: "/nodes/$nodeId",
          params: { nodeId: data.node.id },
          search: {
            view: parseResourceView(new URLSearchParams(location.searchStr).get("view")),
          },
          replace: true,
        });
      }
    }
    try {
      const [, result] = await Promise.all([
        session.authenticated ? context.queryClient.ensureQueryData(spacesQueryOptions) : undefined,
        context.queryClient.ensureQueryData(nodeQueryOptions(params.nodeId)),
      ]);
      if (result.node.resource) {
        await context.queryClient.ensureQueryData(resourceOpenQueryOptions(result.node.resource.id));
      } else if (result.node.capabilities.browseChildren) {
        await context.queryClient.ensureQueryData(nodeChildrenQueryOptions(params.nodeId));
      }
    } catch (error) {
      if (isResourceUnavailableError(error)) throw notFound();
      throw error;
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: NodePage,
});

function NodePage() {
  const { nodeId } = Route.useParams();
  const { view } = Route.useSearch();
  const query = useQuery(nodeQueryOptions(nodeId));
  const resourceId = query.data?.node.resource?.id;
  const resourceQuery = useQuery({
    ...resourceOpenQueryOptions(resourceId ?? ""),
    enabled: resourceId !== undefined,
  });
  const session = useQuery(sessionQueryOptions);
  const { t } = useI18n();
  const { pages } = useModeDefinition();
  const [htmlActionsContainer, setHtmlActionsContainer] = useState<HTMLSpanElement | null>(null);
  const [collaboration, setCollaboration] = useState<{
    nodeId: string;
    members: readonly IMember[];
  }>({ nodeId, members: [] });
  // The shell survives navigation; presence belongs only to the current Node.
  if (collaboration.nodeId !== nodeId) {
    setCollaboration({ nodeId, members: [] });
  }
  const onCollaboratorsChange = useCallback(
    (members: readonly IMember[]) => {
      setCollaboration((current) => (current.nodeId === nodeId ? { nodeId, members } : current));
    },
    [nodeId],
  );

  if (!query.data || !session.data) return null;
  const node = query.data.node;
  const resource = resourceQuery.data?.resource;
  const user = session.data.authenticated ? session.data.user : anonymousUser;
  const selectedNodePath = [...query.data.breadcrumbs.map((item) => item.id), node.id];
  // `/nodes/{id}` already returns the full ancestor chain, including this Node;
  // the shell drops a trailing crumb that repeats the page title.
  const repositoryBreadcrumbs = query.data.breadcrumbs.map((item) => ({
    label: item.name,
    nodeId: item.id,
  }));
  const isEditing = session.data.authenticated && resource?.kind === "univer" && resource.editorMode === "edit";

  if (node.resource === null) {
    return (
      <pages.folder
        detail={query.data}
        username={session.data.authenticated ? session.data.user.username : undefined}
      />
    );
  }
  // Resource content and header controls reset when their identity changes.
  return (
    <WorkspaceLayout
      immersive={node.resource !== null && view === "immersive"}
      selectedSpaceId={query.data.space.id}
      repositoryBreadcrumbs={repositoryBreadcrumbs}
      selectedNodeId={node.id}
      selectedNodePath={selectedNodePath}
      contentMode="editor"
      headerTitle={node.name}
      headerActions={
        node.resource && resource ? (
          <ResourceActions
            key={node.id}
            node={node}
            resource={resource}
            authenticated={session.data.authenticated}
            currentUserId={user.id}
            collaborators={collaboration.members}
            htmlActionsRef={setHtmlActionsContainer}
          />
        ) : undefined
      }
    >
      {resource ? (
        <section key={resource.id} className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
          {resource.kind === "blob" ? (
            <BlobPreview resource={resource} immersive={view === "immersive"} actionsContainer={htmlActionsContainer} />
          ) : (
            <ResourceEditor
              unitId={resource.unitId}
              unitType={resource.unitType}
              user={user}
              readOnly={!isEditing}
              onCollaboratorsChange={onCollaboratorsChange}
            />
          )}
        </section>
      ) : null}
    </WorkspaceLayout>
  );
}
