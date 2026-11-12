import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "../../../../../generated/http/schema";
import { api } from "../../../shared/api/client";
import { ApiError, apiError } from "../../../shared/api/errors";
import { resolveWorkspaceMedia } from "../workspace-media";

export type HtmlViewDraft = components["schemas"]["HtmlViewDraft"];

export function htmlViewDraftQueryOptions(draftId: string) {
  return queryOptions({
    queryKey: ["html-view-drafts", draftId],
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET("/api/html-view-drafts/{draftId}", {
        params: { path: { draftId } }, signal,
      });
      if (response.status === 404) throw new ApiError("Draft not found", "NOT_FOUND");
      if (error) throw apiError(error);
      return data.draft;
    },
    retry: false,
  });
}

export function draftContentQueryOptions(draftId: string) {
  return queryOptions({
    queryKey: ["html-view-drafts", draftId, "content"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/html-view-drafts/{draftId}/content", {
        params: { path: { draftId } }, parseAs: "text", signal,
      });
      if (error) throw apiError(error);
      return resolveWorkspaceMedia(data, window.location.origin, signal);
    },
    staleTime: Infinity,
    retry: false,
  });
}

export function usePublishDraft(draftId: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST("/api/html-view-drafts/{draftId}/publish", {
        params: { path: { draftId } },
      });
      if (response.status === 409) await queries.refetchQueries({ queryKey: htmlViewDraftQueryOptions(draftId).queryKey, exact: true });
      if (error) throw apiError(error);
      return data.draft;
    },
    onSuccess: (draft) => {
      queries.setQueryData(htmlViewDraftQueryOptions(draftId).queryKey, draft);
      for (const key of ["nodes", "resources", "apps"]) void queries.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useRejectDraft(draftId: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST("/api/html-view-drafts/{draftId}/reject", {
        params: { path: { draftId } },
      });
      if (response.status === 409) await queries.refetchQueries({ queryKey: htmlViewDraftQueryOptions(draftId).queryKey, exact: true });
      if (error) throw apiError(error);
      return data.draft;
    },
    onSuccess: (draft) => queries.setQueryData(htmlViewDraftQueryOptions(draftId).queryKey, draft),
  });
}
