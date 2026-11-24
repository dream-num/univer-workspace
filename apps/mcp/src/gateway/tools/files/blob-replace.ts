import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { htmlViewDraftResult, htmlViewDraftSchema } from "../../../shared/html-view-draft.js";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { forkFeature } from "../core/issue-support.js";
import { forkAddressInput } from "../core/space-support.js";
import { stagingStore } from "./staging-support.js";
const inputSchema = z.object({
  resource: z.string(),
  upload_id: z.string(),
  etag: z.string(),
  idempotency_key: z.string().min(1).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  worktree: forkAddressInput.optional(),
});
export const blobReplaceTool: ToolDefinition = {
  name: "blob_replace",
  toolset: "files",
  scope: "publish",
  title: "Replace an uploaded file",
  description:
    "Replace a Blob immediately, preserving its identity. Supply a ready blob upload_id and the exact quoted ETag from blob_download. Generate an idempotency_key before replacing and reuse the same upload, ETag and key on retry. A stale ETag is refused. .univer.html pages go through html_view_save drafts. With a fork address as worktree, the upstream file does not change: the bytes become a draft in the fork's pull request, which a clean fork opens, and the pull request's merge replaces the file. Use the ETag from blob_download with the same worktree. A new replacement of the same file supersedes your pending draft of it. A ready pull request takes no new drafts; use pr_ready with undo: true first. Only existing files are replaced; a fork adds no files.",
  inputSchema,
  outputSchema: z.object({
    replacement: z.object({ operationId: z.string(), resourceId: z.string(), etag: z.string() }).optional(),
    draft: htmlViewDraftSchema.optional(),
  }),
  annotations: destructiveAnnotations,
  async run(context, args) {
    const input = inputSchema.parse(args);
    const store = stagingStore(context);
    await store.requireUpload(context.user.id, input.upload_id, "blob");
    const feature = new WorkspaceBlobFeature(async () => context.http);
    const view = await feature.get(input.resource);
    const output = await store.withUpload(
      context.user.id,
      input.upload_id,
      "blob",
      async (object, path) => {
        const request = { resourceId: input.resource, filePath: path, etag: input.etag, idempotencyKey: input.idempotency_key };
        const result = input.worktree === undefined
          ? { replacement: await feature.replace(request) }
          : { draft: htmlViewDraftResult((await forkFeature(context).replaceBlob(input.worktree, request)).draft) };
        context.usage?.addTransfer("upload_bytes", object.size);
        return result;
      },
    );
    return { output, repo: view.node.spaceId };
  },
};
