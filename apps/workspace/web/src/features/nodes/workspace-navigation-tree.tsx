import { uploadBlob, importDocument } from "./node-transfers";
import {
  WorkspaceFileBrowser,
  type WorkspaceFileBrowserDataSource,
  type WorkspaceFileGrant,
  type WorkspaceFileLinkSharing,
  type WorkspaceFileNode,
  type WorkspaceFileSpace,
  type WorkspaceFileUser,
} from "@univerjs/univer-workspace-file-browser";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import { useI18n } from "../../shared/i18n";
import { useCreateTeamSpace } from "../spaces/spaces.commands";
import { invalidateProductLists } from "./nodes.commands";
import { waitForCreatedResource } from "./wait-for-created-resource";
import { createDocumentInitialData } from "./create-document-initial-data";
import { nodeChildrenQueryOptions, spaceNodesQueryOptions } from "./nodes.queries";

type Space = components["schemas"]["SpaceView"];
type Node = components["schemas"]["NodeSummary"];

export function WorkspaceNavigationTree(props: {
  readonly personalSpace?: Space | undefined;
  readonly teamSpaces: readonly Space[];
  readonly selectedSpaceId?: string | undefined;
  readonly selectedNodeId?: string | undefined;
  readonly selectedNodePath?: readonly string[] | undefined;
  readonly storageScope: string;
}) {
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { mutateAsync: createTeamSpace } = useCreateTeamSpace();
  const spaces = useMemo(
    () =>
      [
        ...(props.personalSpace === undefined ? [] : [props.personalSpace]),
        ...props.teamSpaces,
      ].map(toWorkspaceFileSpace),
    [props.personalSpace, props.teamSpaces],
  );

  const dataSource = useMemo<WorkspaceFileBrowserDataSource>(
    () => ({
      async loadChildren({ spaceId, parentNodeId, signal }) {
        throwIfAborted(signal);
        const page =
          parentNodeId === null
            ? await queryClient.fetchQuery(spaceNodesQueryOptions(spaceId))
            : await queryClient.fetchQuery(nodeChildrenQueryOptions(parentNodeId));
        throwIfAborted(signal);
        return page.nodes.map(toWorkspaceFileNode);
      },
      async createTeamSpace(input) {
        const data = await createTeamSpace(input);
        return toWorkspaceFileSpace(data);
      },
      async createNode(input) {
        let createdNodeId: string | undefined;
        if (input.kind === "folder") {
          const { error } = await api.POST("/api/nodes", {
            body: {
              spaceId: input.spaceId,
              parentNodeId: input.parentNodeId,
              name: input.name,
            },
          });
          if (error) throw apiError(error);
        } else {
          const initialData =
            input.kind === "doc"
              ? await createDocumentInitialData({
                  language,
                  mode: input.documentMode,
                  title: input.name,
                })
              : undefined;
          const { data, error } = await api.POST("/api/resources", {
            params: { header: { "Idempotency-Key": createIdempotencyKey() } },
            body: {
              kind: "univer",
              spaceId: input.spaceId,
              parentNodeId: input.parentNodeId,
              name: input.name,
              unitType: input.kind,
              ...(initialData === undefined ? {} : { initialData: { ...initialData } }),
            },
          });
          if (error) throw apiError(error);
          createdNodeId = await waitForCreatedResource(data, {
            failed: t("resourceCreationFailed"),
            continuing: t("resourceCreationContinuing"),
          });
        }
        await invalidateProductLists(queryClient);
        if (createdNodeId) {
          await navigate({ to: "/nodes/$nodeId", params: { nodeId: createdNodeId } });
        }
      },
      async uploadFile(input) {
        if (IMPORTABLE_DOCUMENT_EXTENSION.test(input.file.name)) {
          await importDocument(input.spaceId, input.parentNodeId, input.file);
        } else {
          await uploadBlob(input.spaceId, input.parentNodeId, input.file);
        }
        await invalidateProductLists(queryClient);
      },
      async renameNode({ node, name }) {
        const { error } = await api.PATCH("/api/nodes/{nodeId}", {
          params: { path: { nodeId: node.id } },
          body: { name },
        });
        if (error) throw apiError(error);
        await invalidateProductLists(queryClient);
      },
      async moveNode({ nodeId, parentNodeId }) {
        const { error } = await api.PATCH("/api/nodes/{nodeId}", {
          params: { path: { nodeId } },
          body: { parentNodeId },
        });
        if (error) throw apiError(error);
        await invalidateProductLists(queryClient);
      },
      async trashNode({ node }) {
        const { error } = await api.POST("/api/nodes/{nodeId}/trash", {
          params: { path: { nodeId: node.id } },
        });
        if (error) throw apiError(error);
        if (router.matchRoute(
          { to: "/nodes/$nodeId", params: { nodeId: node.id } },
          { includeSearch: false },
        )) {
          await navigate({ to: "/home", replace: true });
        }
        await invalidateProductLists(queryClient, { spaceId: node.spaceId });
      },
      nodeUrl(node) {
        return new URL(`/nodes/${encodeURIComponent(node.id)}`, window.location.origin).toString();
      },
      sharing: {
        async loadGrants(nodeId) {
          const { data, error } = await api.GET("/api/nodes/{nodeId}/grants", {
            params: { path: { nodeId } },
          });
          if (error) throw apiError(error);
          return data.grants as readonly WorkspaceFileGrant[];
        },
        async searchUsers(query) {
          const { data, error } = await api.GET("/api/users/search", {
            params: { query: { query } },
          });
          if (error) throw apiError(error);
          return data.users as readonly WorkspaceFileUser[];
        },
        async loadLinkSharing(nodeId) {
          const { data, error } = await api.GET("/api/nodes/{nodeId}/link-sharing", {
            params: { path: { nodeId } },
          });
          if (error) throw apiError(error);
          return data as WorkspaceFileLinkSharing;
        },
        async setGrant({ nodeId, userId, role }) {
          const { error } = await api.PUT("/api/nodes/{nodeId}/grants/{userId}", {
            params: { path: { nodeId, userId } },
            body: { role },
          });
          if (error) throw apiError(error);
        },
        async removeGrant({ nodeId, userId }) {
          const { error } = await api.DELETE("/api/nodes/{nodeId}/grants/{userId}", {
            params: { path: { nodeId, userId } },
          });
          if (error) throw apiError(error);
        },
        async setLinkSharing({ nodeId, enabled, role }) {
          const { error } = await api.PUT("/api/nodes/{nodeId}/link-sharing", {
            params: { path: { nodeId } },
            body: { enabled, role },
          });
          if (error) throw apiError(error);
        },
      },
    }),
    [createTeamSpace, language, navigate, queryClient, router, t],
  );

  return (
    <WorkspaceFileBrowser
      spaces={spaces}
      dataSource={dataSource}
      storageScope={props.storageScope}
      locale={language}
      {...(props.selectedSpaceId === undefined ? {} : { selectedSpaceId: props.selectedSpaceId })}
      {...(props.selectedNodeId === undefined ? {} : { selectedNodeId: props.selectedNodeId })}
      {...(props.selectedNodePath === undefined ? {} : { selectedNodePath: props.selectedNodePath })}
      onOpenSpace={(space) => {
        void navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } });
      }}
      onOpenNode={(node) => {
        void navigate({ to: "/nodes/$nodeId", params: { nodeId: node.id } });
      }}
    />
  );
}

const IMPORTABLE_DOCUMENT_EXTENSION = /\.(?:xls|xlsx|csv|tsv|doc|docx|ppt|pptx)$/iu;

function toWorkspaceFileSpace(space: Space): WorkspaceFileSpace {
  return {
    id: space.id,
    type: space.type,
    name: space.name,
    accessRole: space.accessRole,
    capabilities: space.capabilities,
  };
}

function toWorkspaceFileNode(node: Node): WorkspaceFileNode {
  return {
    id: node.id,
    spaceId: node.spaceId,
    parentNodeId: node.parentNodeId,
    name: node.name,
    resource:
      node.resource === null
        ? null
        : node.resource.kind === "univer"
          ? { id: node.resource.id, kind: node.resource.kind, unitType: node.resource.unitType }
          : { id: node.resource.id, kind: node.resource.kind, mediaType: node.resource.mediaType },
    hasChildren: node.hasChildren,
    accessRole: node.accessRole,
    capabilities: node.capabilities,
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The request was aborted.", "AbortError");
}
