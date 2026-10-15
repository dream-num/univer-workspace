import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import type { AppLanguage } from "../../shared/i18n";
import { createDocumentInitialData, type NewDocumentMode } from "./create-document-initial-data";
import { waitForCreatedResource } from "./wait-for-created-resource";
import { uploadBlob, importDocument } from "./node-transfers";
import { nodeQueryOptions } from "./nodes.queries";
import { resourceOpenQueryOptions } from "../resources/resources.queries";
import { trashQueryKey } from "../trash/trash.queries";
import { htmlViewsQueryKey } from "../views/html-views.queries";
import { ownedByMeQueryKey } from "../views/owned.queries";
import { recentResourcesQueryKey } from "../views/recent.queries";
import { sharedWithMeQueryKey } from "../views/shared.queries";

export async function invalidateProductLists(
  client: QueryClient,
  options: { readonly spaceId?: string; readonly htmlViews?: boolean } = {},
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["nodes"] }),
    client.invalidateQueries({ queryKey: recentResourcesQueryKey }),
    client.invalidateQueries({ queryKey: ownedByMeQueryKey }),
    client.invalidateQueries({ queryKey: sharedWithMeQueryKey }),
    ...(options.spaceId === undefined ? [] : [client.invalidateQueries({ queryKey: trashQueryKey(options.spaceId) })]),
    ...(options.htmlViews ? [client.invalidateQueries({ queryKey: htmlViewsQueryKey })] : []),
  ]);
}

type Destination = {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
};

export function useCreateFolder(noWritableSpace: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Destination & { readonly name: string }) => {
      if (!input.spaceId) throw new Error(noWritableSpace);
      const { data, error } = await api.POST("/api/nodes", { body: input });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: () => invalidateProductLists(client),
  });
}

export function useCreateUniverResource(
  language: AppLanguage,
  messages: {
    readonly noWritableSpace: string;
    readonly failed: string;
    readonly continuing: string;
  },
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Destination & {
        readonly name: string;
        readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
        readonly documentMode: NewDocumentMode;
      },
    ) => {
      if (!input.spaceId) throw new Error(messages.noWritableSpace);
      const initialData =
        input.unitType === "doc"
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
          unitType: input.unitType,
          ...(initialData === undefined ? {} : { initialData: { ...initialData } }),
        },
      });
      if (error) throw apiError(error);
      return waitForCreatedResource(data, messages);
    },
    onSuccess: () => invalidateProductLists(client),
  });
}

export function useUploadBlob(messages: {
  readonly noWritableSpace: string;
  readonly failed: string;
  readonly readResponseError: boolean;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Destination & { readonly file: File }) => {
      if (!input.spaceId) throw new Error(messages.noWritableSpace);
      return uploadBlob(input.spaceId, input.parentNodeId, input.file, messages.failed, messages.readResponseError);
    },
    onSuccess: () => invalidateProductLists(client),
  });
}

export function useImportDocument(messages: {
  readonly noWritableSpace: string;
  readonly failed: string;
  readonly requireUnitId: boolean;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Destination & { readonly file: File }) => {
      if (!input.spaceId) throw new Error(messages.noWritableSpace);
      return importDocument(input.spaceId, input.parentNodeId, input.file, messages.failed, messages.requireUnitId);
    },
    onSuccess: () => invalidateProductLists(client),
  });
}

export function useUpdateNode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly nodeId: string;
      readonly body: {
        readonly name?: string;
        readonly parentNodeId?: string | null;
      };
      readonly resourceId?: string;
    }) => {
      const { data, error } = await api.PATCH("/api/nodes/{nodeId}", {
        params: { path: { nodeId: input.nodeId } },
        body: input.body,
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async (_, input) => {
      await Promise.all([
        ...(input.resourceId === undefined
          ? []
          : [
              client.invalidateQueries({
                queryKey: nodeQueryOptions(input.nodeId).queryKey,
              }),
              client.invalidateQueries({
                queryKey: resourceOpenQueryOptions(input.resourceId).queryKey,
              }),
            ]),
        invalidateProductLists(client, {
          htmlViews: input.resourceId !== undefined,
        }),
      ]);
    },
  });
}

export function useTrashNode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly nodeId: string;
      readonly spaceId: string;
      readonly beforeInvalidate?: () => Promise<void>;
    }) => {
      const { error } = await api.POST("/api/nodes/{nodeId}/trash", {
        params: { path: { nodeId: input.nodeId } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: async (_, input) => {
      // 当前文档须先卸载，再失效其查询，避免刷新已移入回收站的节点。
      await input.beforeInvalidate?.();
      await invalidateProductLists(client, { spaceId: input.spaceId });
    },
  });
}
