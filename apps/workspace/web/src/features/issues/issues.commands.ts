import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { issuesQueryKey } from "./issues.queries";

export function useCreateIssue(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: components["schemas"]["CreateIssue"]) => {
      const { data, error } = await api.POST("/api/spaces/{spaceId}/issues", {
        params: { path: { spaceId } },
        body: input,
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: issuesQueryKey }),
  });
}

export function useUpdateIssue(spaceId: string, number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: components["schemas"]["UpdateIssue"]) => {
      const { error } = await api.PATCH("/api/spaces/{spaceId}/issues/{number}", {
        params: { path: { spaceId, number } },
        body: input,
      });
      if (error) throw apiError(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: issuesQueryKey }),
  });
}

export function useAddIssueComment(spaceId: string, number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      const { error } = await api.POST("/api/spaces/{spaceId}/issues/{number}/comments", {
        params: { path: { spaceId, number } },
        body: { body: text },
      });
      if (error) throw apiError(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: issuesQueryKey }),
  });
}

export function useUpdateIssueComment(commentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly body: string; readonly beforeInvalidate?: () => void }) => {
      const { error } = await api.PATCH("/api/issue-comments/{commentId}", {
        params: { path: { commentId } },
        body: { body: input.body },
      });
      if (error) throw apiError(error);
    },
    onSuccess: async (_, input) => {
      input.beforeInvalidate?.();
      await client.invalidateQueries({ queryKey: issuesQueryKey });
    },
  });
}

export function useDeleteIssueComment(commentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/api/issue-comments/{commentId}", {
        params: { path: { commentId } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: issuesQueryKey }),
  });
}

export function useCreateIssueLabel(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: components["schemas"]["CreateIssueLabel"]) => {
      const { error } = await api.POST("/api/spaces/{spaceId}/issue-labels", {
        params: { path: { spaceId } },
        body: input,
      });
      if (error) throw apiError(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: issuesQueryKey }),
  });
}

export function useUpdateIssueLabel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly labelId: string;
      readonly body: components["schemas"]["UpdateIssueLabel"];
    }) => {
      const { error } = await api.PATCH("/api/issue-labels/{labelId}", {
        params: { path: { labelId: input.labelId } },
        body: input.body,
      });
      if (error) throw apiError(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: issuesQueryKey }),
  });
}

export function useDeleteIssueLabel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (labelId: string) => {
      const { error } = await api.DELETE("/api/issue-labels/{labelId}", {
        params: { path: { labelId } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: issuesQueryKey }),
  });
}
