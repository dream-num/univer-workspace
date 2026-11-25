import { readFile } from "node:fs/promises";
import { findWorkspaceHtmlViewDraft, isForkAddress, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { htmlViewInput, htmlViewMaxBytes } from "../../../shared/executor-protocol.js";
import type { ToolContext } from "../definition.js";
import { forkFeature, repoInput } from "../core/issue-support.js";
import { findPr, pullNumberInput } from "../core/pr-support.js";
import { worktreeOrForkInput } from "../core/space-support.js";
import { stagingStore } from "./staging-support.js";

export const htmlViewSourceSchema = z.object({
  html: htmlViewInput.optional(),
  html_upload_id: z.string().min(1).optional(),
}).refine(
  (input) => (input.html === undefined) !== (input.html_upload_id === undefined),
  "Provide exactly one of html or html_upload_id.",
);

export async function readHtmlView(input: z.infer<typeof htmlViewSourceSchema>, context: ToolContext) {
  if (input.html !== undefined) return input.html;
  return stagingStore(context).withUpload(
    context.user.id,
    z.string().parse(input.html_upload_id),
    "html-view",
    async (object, path) => {
      if (object.size > htmlViewMaxBytes)
        throw workspaceError("workspace-argument-invalid", "HTML exceeds the 512 KiB UTF-8 limit.");
      const bytes = await readFile(path);
      let html: string;
      try {
        // Keep the BOM so re-encoding publishes the exact validated bytes.
        html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw workspaceError("workspace-argument-invalid", "HTML upload must be valid UTF-8.");
      }
      htmlViewInput.parse(html);
      context.usage?.addTransfer("upload_bytes", bytes.length);
      return html;
    },
  );
}

export const htmlViewPullRequestShape = {
  worktree: worktreeOrForkInput.optional(),
  repo: repoInput.optional(),
  pr: pullNumberInput.optional(),
};

/** A save through a clean fork opens its Worktree; a dry run there reads trunk and opens nothing. */
export async function htmlViewWorktree(
  input: z.infer<z.ZodObject<typeof htmlViewPullRequestShape>>, context: ToolContext, save: boolean,
): Promise<{ readonly sourceWorktreeId?: string }> {
  if (input.worktree !== undefined) {
    if (input.repo !== undefined || input.pr !== undefined)
      throw workspaceError("workspace-argument-invalid", "Provide worktree or repo with pr, not both.");
    if (!isForkAddress(input.worktree)) return { sourceWorktreeId: input.worktree };
    const forks = forkFeature(context);
    const worktree = save ? await forks.openWorktree(input.worktree) : await forks.readWorktree(input.worktree);
    return worktree === null ? {} : { sourceWorktreeId: worktree.id };
  }
  if (input.pr === undefined) return {};
  if (input.repo === undefined)
    throw workspaceError("workspace-argument-invalid", "Provide repo with the source pull request.");
  const { worktree } = await findPr(context, input.repo, input.pr);
  return { sourceWorktreeId: worktree.id };
}

export async function pendingPageDraft(context: ToolContext, worktreeId: string, resourceId: string) {
  return await findWorkspaceHtmlViewDraft(async () => context.http, context.identityOrigin, {
    worktreeId, resourceId, authorId: context.user.id,
  });
}
