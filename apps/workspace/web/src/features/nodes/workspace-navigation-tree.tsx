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
import { useI18n } from "../../shared/i18n";
import { useCreateTeamSpace } from "../spaces/spaces.commands";
import { useCreateFolder, useCreateUniverResource, useUploadBlob, useImportDocument, useUpdateNode, useTrashNode } from "./nodes.commands";
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
  const { mutateAsync: createFolder } = useCreateFolder(t("noWritableSpace"));
  const { mutateAsync: createResource } = useCreateUniverResource(language, {
    noWritableSpace: t("noWritableSpace"), failed: t("resourceCreationFailed"), continuing: t("resourceCreationContinuing"),
  });
  const { mutateAsync: uploadBlob } = useUploadBlob({
    noWritableSpace: t("noWritableSpace"), failed: "File upload failed.", readResponseError: false,
  });
  const { mutateAsync: importDocument } = useImportDocument({
    noWritableSpace: t("noWritableSpace"), failed: "File import failed.", requireUnitId: false,
  });
  const { mutateAsync: updateNode } = useUpdateNode();
  const { mutateAsync: trashNode } = useTrashNode();
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
        if (input.kind === "folder") {
          await createFolder({ spaceId: input.spaceId, parentNodeId: input.parentNodeId, name: input.name });
        } else {
          const nodeId = await createResource({
            spaceId: input.spaceId, parentNodeId: input.parentNodeId, name: input.name,
            unitType: input.kind, documentMode: input.documentMode,
          });
          await navigate({ to: "/nodes/$nodeId", params: { nodeId } });
        }
      },
      async uploadFile(input) {
        if (IMPORTABLE_DOCUMENT_EXTENSION.test(input.file.name)) await importDocument(input);
        else await uploadBlob(input);
      },
      async renameNode({ node, name }) {
        await updateNode({ nodeId: node.id, body: { name } });
      },
      async moveNode({ nodeId, parentNodeId }) {
        await updateNode({ nodeId, body: { parentNodeId } });
      },
      async trashNode({ node }) {
        await trashNode({
          nodeId: node.id,
          spaceId: node.spaceId,
          beforeInvalidate: async () => {
            if (router.matchRoute(
              { to: "/nodes/$nodeId", params: { nodeId: node.id } },
              { includeSearch: false },
            )) {
              await navigate({ to: "/home", replace: true });
            }
          },
        });
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
    [createTeamSpace, createFolder, createResource, uploadBlob, importDocument, updateNode, trashNode, navigate, queryClient, router],
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
