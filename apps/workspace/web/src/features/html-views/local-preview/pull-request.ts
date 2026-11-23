import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../../shared/api/client";
import { apiError } from "../../../shared/api/errors";
import { worktreeByNumberQueryOptions } from "../../worktrees";
import type { HtmlViewSourceWorktree } from "../workspace-binding-engine";

/** The pull request's Worktree supplies the page's source data. The page never writes to it. */
export async function loadPreviewWorktree(queryClient: QueryClient, { repo, pr }: { repo?: string | undefined; pr?: number | undefined }): Promise<{ worktree: HtmlViewSourceWorktree | undefined }> {
  if (!repo || pr === undefined) return { worktree: undefined };
  const [owner = "", slug = ""] = repo.split("/");
  const space = await api.GET("/api/spaces/lookup", { params: { query: { owner, slug } } });
  if (space.error) throw apiError(space.error);
  return queryClient.fetchQuery(worktreeByNumberQueryOptions(space.data.id, pr));
}
