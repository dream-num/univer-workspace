import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { Cloud, Download, Lock, Share2 } from "lucide-react";
import { useState } from "react";
import type { components } from "../../../generated/http/schema.js";
import {
  NodeBrowser,
  ResourceUnavailablePage,
  isResourceUnavailableError,
  nodeChildrenQueryOptions,
  nodeQueryOptions,
} from "../features/nodes";
import {
  requireAuthenticatedSession,
  sessionQueryOptions,
} from "../features/auth";
import { resourceOpenQueryOptions } from "../features/resources";
import { ShareDialog } from "../features/permissions";
import { spacesQueryOptions } from "../features/spaces";
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";
import { ResourceEditor } from "../features/editor";
import { BlobPreview } from "../features/blobs";
import { api } from "../shared/api/client";
import { apiError } from "../shared/api/errors";
import { useI18n } from "../shared/i18n";
import { Button, EditableText, Tooltip, buttonVariants, toast } from "../shared/ui";
import { cn } from "../shared/utils/cn";

type Node = components["schemas"]["NodeSummary"];
export const Route = createFileRoute("/nodes/$nodeId")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(typeof search.unit === "string" && search.unit
      ? { unit: search.unit }
      : {}),
  }),
  loaderDeps: ({ search }) => ({ unit: search.unit }),
  loader: async ({ context, deps, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
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
          search: {},
          replace: true,
        });
      }
    }
    try {
      const [, result] = await Promise.all([
        context.queryClient.ensureQueryData(spacesQueryOptions),
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
  const query = useQuery(nodeQueryOptions(nodeId));
  const children = useQuery({
    ...nodeChildrenQueryOptions(nodeId),
    enabled:
      query.data?.node.resource === null &&
      query.data.node.capabilities.browseChildren,
  });
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  if (!query.data) return null;
  const selectedNodePath = [
    ...query.data.breadcrumbs.map((item) => item.id),
    query.data.node.id,
  ];
  if (query.data.node.resource) {
    return (
      <OpenResourcePage
        node={query.data.node}
        selectedNodePath={selectedNodePath}
      />
    );
  }
  if (!children.data) return null;
  return (
    <WorkspaceLayout
      selectedSpaceId={query.data.space.id}
      selectedNodeId={query.data.node.id}
      selectedNodePath={selectedNodePath}
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchNodes")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      <NodeBrowser
        page={children.data}
        searchQuery={searchQuery}
      />
    </WorkspaceLayout>
  );
}

function OpenResourcePage({
  node,
  selectedNodePath,
}: {
  readonly node: Node;
  readonly selectedNodePath: readonly string[];
}) {
  const resource = node.resource;
  if (!resource) return null;
  return (
    <LoadedResourcePage
      node={node}
      resourceId={resource.id}
      selectedNodePath={selectedNodePath}
    />
  );
}

function LoadedResourcePage({
  node,
  resourceId,
  selectedNodePath,
}: {
  readonly node: Node;
  readonly resourceId: string;
  readonly selectedNodePath: readonly string[];
}) {
  const { data } = useQuery(resourceOpenQueryOptions(resourceId));
  const session = useQuery(sessionQueryOptions);
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [shareOpen, setShareOpen] = useState(false);
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const { data: updated, error } = await api.PATCH(
        "/api/nodes/{nodeId}",
        {
          params: { path: { nodeId: node.id } },
          body: { name },
        }
      );
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
      toast.error(
        error instanceof Error ? error.message : t("resourceRenameFailed")
      ),
  });
  if (!data || !session.data?.authenticated) return null;
  if (data.resource.kind === "blob") {
    return (
      <>
        <WorkspaceLayout
          selectedSpaceId={data.resource.spaceId}
          selectedNodeId={node.id}
          selectedNodePath={selectedNodePath}
          contentMode="editor"
          headerTitle={
            <EditableText
              value={node.name}
              canEdit={node.capabilities.rename}
              editLabel={t("renameResource")}
              onCommit={(name) => rename.mutate(name)}
            />
          }
          headerActions={
            <>
              <a
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                  "no-underline"
                )}
                href={data.resource.downloadUrl}
              >
                <Download />
                {t("download")}
              </a>
              {node.capabilities.share ? (
                <Button size="sm" onClick={() => setShareOpen(true)}>
                  <Share2 />
                  {t("shareAction")}
                </Button>
              ) : null}
            </>
          }
        >
          <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
            <BlobPreview resource={data.resource} />
          </section>
        </WorkspaceLayout>
        <ShareDialog
          node={shareOpen ? { id: node.id, name: node.name } : null}
          onClose={() => setShareOpen(false)}
        />
      </>
    );
  }
  const isEditing = data.resource.editorMode === "edit";
  const modeLabel = isEditing ? t("editingMode") : t("readOnlyMode");
  return (
    <>
      <WorkspaceLayout
        selectedSpaceId={data.resource.spaceId}
        selectedNodeId={node.id}
        selectedNodePath={selectedNodePath}
        contentMode="editor"
        headerTitle={
          <EditableText
            value={node.name}
            canEdit={node.capabilities.rename}
            editLabel={t("renameResource")}
            onCommit={(name) => rename.mutate(name)}
          />
        }
        headerActions={
          <>
            <Tooltip content={modeLabel}>
              <span
                aria-label={modeLabel}
                className={cn(
                  "grid size-8 place-items-center rounded-md [&_svg]:size-4",
                  isEditing
                    ? "bg-success-soft text-success-soft-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isEditing ? <Cloud /> : <Lock />}
              </span>
            </Tooltip>
            {node.capabilities.share ? (
              <Button size="sm" onClick={() => setShareOpen(true)}>
                <Share2 />
                {t("shareAction")}
              </Button>
            ) : null}
          </>
        }
      >
        <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
          <ResourceEditor
            unitId={data.resource.unitId}
            unitType={data.resource.unitType}
            user={session.data.user}
            readOnly={!isEditing}
          />
        </section>
      </WorkspaceLayout>
      <ShareDialog
        node={shareOpen ? { id: node.id, name: node.name } : null}
        onClose={() => setShareOpen(false)}
      />
    </>
  );
}
