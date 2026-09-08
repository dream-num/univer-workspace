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
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import { useI18n } from "../../shared/i18n";
import { spacesQueryKey } from "../spaces";
import { trashQueryKey } from "../trash";
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
  const { language } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const spaces = useMemo(
    () =>
      [
        ...(props.personalSpace === undefined ? [] : [props.personalSpace]),
        ...props.teamSpaces,
      ].map(toWorkspaceFileSpace),
    [props.personalSpace, props.teamSpaces],
  );

  const refreshProductLists = useCallback(
    async (spaceId?: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["nodes"] }),
        queryClient.invalidateQueries({ queryKey: ["recent-resources"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
        queryClient.invalidateQueries({ queryKey: ["shared-with-me"] }),
        ...(spaceId === undefined
          ? []
          : [queryClient.invalidateQueries({ queryKey: trashQueryKey(spaceId) })]),
      ]);
    },
    [queryClient],
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
        const { data, error } = await api.POST("/api/team-spaces", { body: input });
        if (error) throw apiError(error);
        await queryClient.invalidateQueries({ queryKey: spacesQueryKey });
        return toWorkspaceFileSpace(data);
      },
      async createNode(input) {
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
          const { error } = await api.POST("/api/resources", {
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
        }
        await refreshProductLists();
      },
      async uploadFile(input) {
        if (IMPORTABLE_DOCUMENT_EXTENSION.test(input.file.name)) {
          await importDocument(input.spaceId, input.parentNodeId, input.file);
        } else {
          await uploadBlob(input.spaceId, input.parentNodeId, input.file);
        }
        await refreshProductLists();
      },
      async renameNode({ node, name }) {
        const { error } = await api.PATCH("/api/nodes/{nodeId}", {
          params: { path: { nodeId: node.id } },
          body: { name },
        });
        if (error) throw apiError(error);
        await refreshProductLists();
      },
      async moveNode({ nodeId, parentNodeId }) {
        const { error } = await api.PATCH("/api/nodes/{nodeId}", {
          params: { path: { nodeId } },
          body: { parentNodeId },
        });
        if (error) throw apiError(error);
        await refreshProductLists();
      },
      async trashNode({ node }) {
        const { error } = await api.POST("/api/nodes/{nodeId}/trash", {
          params: { path: { nodeId: node.id } },
        });
        if (error) throw apiError(error);
        await refreshProductLists(node.spaceId);
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
    [language, queryClient, refreshProductLists],
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

async function uploadBlob(spaceId: string, parentNodeId: string | null, file: File) {
  const { data: reserved, error: reserveError } = await api.POST("/api/blob-upload-sessions", {
    params: { header: { "Idempotency-Key": createIdempotencyKey() } },
    body: {
      spaceId,
      parentNodeId,
      name: file.name,
      originalFilename: file.name,
      byteSize: file.size,
      ...(file.type ? { declaredMediaType: file.type } : {}),
    },
  });
  if (reserveError) throw apiError(reserveError);
  if (!reserved.uploadTarget) throw new Error("File upload failed.");
  try {
    const response = await fetch(reserved.uploadTarget.contentUrl, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    if (!response.ok) throw new Error("File upload failed.");
    const { error } = await api.POST("/api/blob-upload-sessions/{uploadId}/complete", {
      params: { path: { uploadId: reserved.upload.id } },
    });
    if (error) throw apiError(error);
  } catch (reason) {
    await api
      .DELETE("/api/blob-upload-sessions/{uploadId}", {
        params: { path: { uploadId: reserved.upload.id } },
      })
      .catch(() => undefined);
    throw reason;
  }
}

async function importDocument(spaceId: string, parentNodeId: string | null, file: File) {
  const form = new FormData();
  form.append("file", file);
  const upload = await fetch(
    `/universer-api/stream/file/upload?size=${encodeURIComponent(file.size)}&source=1&flate=false`,
    { method: "POST", credentials: "include", body: form },
  );
  const uploaded = (await upload.json().catch(() => null)) as { readonly FileId?: string } | null;
  if (!upload.ok || !uploaded?.FileId) throw new Error("File import failed.");
  const start = await fetch("/universer-api/exchange/import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileID: uploaded.FileId, outputType: 1, spaceId, parentNodeId }),
  });
  const started = (await start.json().catch(() => null)) as { readonly taskID?: string } | null;
  if (!start.ok || !started?.taskID) throw new Error("File import failed.");
  await waitForDocumentImport(started.taskID);
}

async function waitForDocumentImport(taskId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`/universer-api/exchange/task/${encodeURIComponent(taskId)}`, {
      credentials: "include",
    });
    const task = (await response.json().catch(() => null)) as
      | { readonly status?: string; readonly error?: { readonly message?: string } }
      | null;
    if (!response.ok) throw new Error(task?.error?.message ?? "File import failed.");
    if (task?.status === "done") return;
    if (task?.status === "failed") throw new Error(task.error?.message ?? "File import failed.");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("File import failed.");
}

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
