import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import { Download, Lock, Maximize, Pencil, Share2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { IMember } from "@univerjs/protocol";
import type { components } from "../../../generated/http/schema.js";
import {
  NodeBrowser,
  ResourceUnavailablePage,
  isResourceUnavailableError,
  nodeChildrenQueryOptions,
  nodeQueryOptions,
} from "../features/nodes";
import {
  anonymousUser,
  sessionQueryOptions,
} from "../features/auth";
import { resourceOpenQueryOptions } from "../features/resources";
import { ShareDialog } from "../features/permissions";
import { spacesQueryOptions } from "../features/spaces";
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";
import { CollaboratorAvatars, ResourceEditor } from "../features/editor";
import { BlobPreview } from "../features/blobs";
import { api } from "../shared/api/client";
import { apiError } from "../shared/api/errors";
import { useI18n } from "../shared/i18n";
import { Button, EditableText, Tooltip, buttonVariants, toast } from "../shared/ui";
import { cn } from "../shared/utils/cn";
import { parseResourceView } from "../features/resource-view/resource-view";

type Node = components["schemas"]["NodeSummary"];
export const Route = createFileRoute("/nodes/$nodeId")({
  validateSearch: (
    search: Readonly<Record<string, unknown>>,
  ): { unit?: string; view?: "immersive" | undefined } => ({
    ...(parseResourceView(search.view) ? { view: "immersive" as const } : {}),
    ...(typeof search.unit === "string" && search.unit
      ? { unit: search.unit }
      : {}),
  }),
  loaderDeps: ({ search }) => ({ unit: search.unit }),
  loader: async ({ context, deps, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (deps.unit) {
      const { data } = await api.GET("/api/unit-resources/{unitId}", {
        params: { path: { unitId: deps.unit } },
      });
      if (data) {
        await Promise.all([
          context.queryClient.invalidateQueries({ queryKey: ["nodes"] }),
          context.queryClient.invalidateQueries({
            queryKey: ["recent-resources"],
          }),
          context.queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
        ]);
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
        session.authenticated
          ? context.queryClient.ensureQueryData(spacesQueryOptions)
          : undefined,
        context.queryClient.ensureQueryData(nodeQueryOptions(params.nodeId)),
      ]);
      if (result.node.resource) {
        await context.queryClient.ensureQueryData(
          resourceOpenQueryOptions(result.node.resource.id)
        );
      } else if (result.node.capabilities.browseChildren) {
        await context.queryClient.ensureQueryData(
          nodeChildrenQueryOptions(params.nodeId)
        );
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
  const children = useQuery({
    ...nodeChildrenQueryOptions(nodeId),
    enabled: query.data?.node.resource === null && query.data.node.capabilities.browseChildren,
  });
  const resourceId = query.data?.node.resource?.id;
  const resourceQuery = useQuery({
    ...resourceOpenQueryOptions(resourceId ?? ""),
    enabled: resourceId !== undefined,
  });
  const session = useQuery(sessionQueryOptions);
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
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
  const isEditing =
    session.data.authenticated && resource?.kind === "univer" && resource.editorMode === "edit";

  // Keep one layout for folders, Blobs and Univer documents. Only the resource
  // content and its header controls reset when their identity changes.
  return (
    <WorkspaceLayout
      immersive={node.resource !== null && view === "immersive"}
      selectedSpaceId={query.data.space.id}
      selectedNodeId={node.id}
      selectedNodePath={selectedNodePath}
      contentMode={node.resource ? "editor" : "default"}
      headerTitle={
        node.resource ? (
          <ResourceTitle
            key={node.id}
            node={node}
            resourceId={node.resource.id}
            authenticated={session.data.authenticated}
          />
        ) : undefined
      }
      headerContent={
        node.resource ? undefined : (
          <WorkspaceHeaderSearch
            placeholder={t("searchNodes")}
            value={searchQuery}
            onChange={setSearchQuery}
          />
        )
      }
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
      {node.resource ? (
        resource ? (
          <section
            key={resource.id}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
          >
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
        ) : null
      ) : children.data ? (
        <NodeBrowser page={children.data} searchQuery={searchQuery} />
      ) : null}
    </WorkspaceLayout>
  );
}

function ResourceTitle({
  node,
  resourceId,
  authenticated,
}: {
  readonly node: Node;
  readonly resourceId: string;
  readonly authenticated: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const { data: updated, error } = await api.PATCH("/api/nodes/{nodeId}", {
        params: { path: { nodeId: node.id } },
        body: { name },
      });
      if (error) throw apiError(error);
      return updated;
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: nodeQueryOptions(node.id).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: resourceOpenQueryOptions(resourceId).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: ["nodes"] }),
        queryClient.invalidateQueries({ queryKey: ["recent-resources"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
        queryClient.invalidateQueries({ queryKey: ["shared-with-me"] }),
      ]);
      toast.success(t("resourceRenamed", { name: updated.name }));
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("resourceRenameFailed")),
  });
  return (
    <EditableText
      value={node.name}
      canEdit={authenticated && node.capabilities.rename}
      editLabel={t("renameResource")}
      onCommit={(name) => rename.mutate(name)}
    />
  );
}

function ResourceActions({
  node,
  resource,
  authenticated,
  currentUserId,
  collaborators,
  htmlActionsRef,
}: {
  readonly node: Node;
  readonly resource: components["schemas"]["ResourceOpenView"]["resource"];
  readonly authenticated: boolean;
  readonly currentUserId: string;
  readonly collaborators: readonly IMember[];
  readonly htmlActionsRef: (element: HTMLSpanElement | null) => void;
}) {
  const { t } = useI18n();
  const [shareOpen, setShareOpen] = useState(false);
  const isEditing = authenticated && resource.kind === "univer" && resource.editorMode === "edit";
  const modeLabel = isEditing ? t("editingMode") : t("readOnlyMode");
  return (
    <>
      {resource.kind === "blob" && isHtmlViewFilename(resource.originalFilename) ? (
          <span ref={htmlActionsRef} className="contents" />
        ) : null}
      {resource.kind === "blob" ? (
        <a
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "no-underline")}
          href={resource.downloadUrl}
        >
          <Download />
          {t("download")}
        </a>
      ) : (
        <CollaboratorAvatars members={collaborators} currentUserId={currentUserId} />
      )}
      {authenticated && node.capabilities.share ? (
        <Button size="sm" onClick={() => setShareOpen(true)}>
          <Share2 />
          {t("shareAction")}
        </Button>
      ) : null}
      {authenticated && resource.kind === "univer" ? (
        <Tooltip content={modeLabel}>
          <span
            aria-label={modeLabel}
            className="grid size-8 shrink-0 place-items-center text-secondary-foreground [&_svg]:size-4"
          >
            {isEditing ? <Pencil aria-hidden="true" /> : <Lock aria-hidden="true" />}
          </span>
        </Tooltip>
      ) : null}
      <Tooltip content={t("enterImmersiveView")}>
        <Link
          to="/nodes/$nodeId"
          params={{ nodeId: node.id }}
          aria-label={t("enterImmersiveView")}
          hash={true}
          resetScroll={false}
          search={(previous) => ({ ...previous, view: "immersive" })}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "shrink-0 text-muted-foreground no-underline [&_svg]:size-4",
          )}
        >
          <Maximize strokeWidth={1.75} />
        </Link>
      </Tooltip>
      <ShareDialog node={shareOpen ? node : null} onClose={() => setShareOpen(false)} />
    </>
  );
}
