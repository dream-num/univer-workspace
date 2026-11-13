import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { decodeSkillFile } from "./review-presentation";
import { skillPreview } from "./review-model";
import { api } from "../../shared/api/client";
import { ApiError, apiError } from "../../shared/api/errors";

export function skillDraftQueryOptions(draftId: string) {
  return queryOptions({
    queryKey: ["skill-drafts", draftId],
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET("/api/skill-drafts/{draftId}", {
        params: { path: { draftId } },
        signal,
      });
      if (response.status === 404) throw new ApiError("Draft not found", "NOT_FOUND");
      if (error) throw apiError(error);
      return data.draft;
    },
    retry: false,
    refetchInterval: (query) => (query.state.data?.state === "pending" ? 30_000 : false),
  });
}

export function skillContentQueryOptions(
  draftId: string,
  path: string,
  version: "draft" | "current",
) {
  return queryOptions({
    queryKey: ["skill-drafts", draftId, "content", path, version],
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET("/api/skill-drafts/{draftId}/content", {
        params: { path: { draftId }, query: { path, version } },
        parseAs: "text",
        signal,
      });
      if (version === "current" && response.status === 404) return null;
      if (error) throw apiError(error);
      return data;
    },
    retry: false,
    gcTime: 0,
  });
}

export function skillPreviewQueryOptions(draftId: string, name: string, text: string | undefined) {
  return queryOptions({
    queryKey: ["skill-drafts", draftId, "preview"],
    queryFn: () => skillPreview(name, text ?? ""),
    enabled: text !== undefined,
    gcTime: 0,
    retry: false,
  });
}

export function useSkillDraftDecision(draftId: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async (decision: "publish" | "reject") => {
      const endpoint =
        decision === "publish"
          ? "/api/skill-drafts/{draftId}/publish"
          : "/api/skill-drafts/{draftId}/reject";
      const { data, error, response } = await api.POST(endpoint, { params: { path: { draftId } } });
      if (response.status === 409)
        await queries.refetchQueries({
          queryKey: skillDraftQueryOptions(draftId).queryKey,
          exact: true,
        });
      if (error) throw apiError(error);
      return data.draft;
    },
    onSuccess: (draft) => {
      queries.setQueryData(skillDraftQueryOptions(draftId).queryKey, draft);
      for (const key of ["nodes", "resources"]) void queries.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function skillBaseFileQueryOptions(draftId: string, path: string) {
  return queryOptions({
    queryKey: ["skill-drafts", draftId, "base-file", path],
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET("/api/skill-drafts/{draftId}/content", {
        params: { path: { draftId }, query: { path, version: "current" } },
        parseAs: "arrayBuffer",
        signal,
      });
      if (response.status === 404) return null;
      if (error) throw apiError(error);
      return decodeSkillFile(data);
    },
    retry: false,
    gcTime: 0,
  });
}
