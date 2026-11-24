import { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { downloadSchema } from "../../staging/model.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { forkFeature } from "../core/issue-support.js";
import { forkAddressInput } from "../core/space-support.js";
import { stagingStore } from "./staging-support.js";
const inputSchema = z.object({ resource: z.string(), worktree: forkAddressInput.optional() });
export const blobDownloadTool: ToolDefinition = {
  name: "blob_download",
  toolset: "files",
  scope: "read",
  title: "Download an uploaded file",
  description:
    "Return a private capability download link valid for 15 minutes and the quoted ETag required by blob_replace. GET download.url to fetch the bytes; keep the link private. With a fork address as worktree, returns your pending draft of the file in the fork's pull request, with its id as draft, or the upstream file otherwise; the ETag is the upstream file's either way.",
  inputSchema,
  outputSchema: z.object({ download: downloadSchema, etag: z.string(), draft: z.string().optional() }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { resource, worktree } = inputSchema.parse(args);
    const store = stagingStore(context);
    const { draft, ...stream } = worktree === undefined
      ? { ...(await new WorkspaceBlobFeature(async () => context.http).downloadStream(resource)), draft: null }
      : await forkFeature(context).openBlob(worktree, resource);
    try {
      const download = await store.createDownload({
        owner: context.user.id,
        fileName: stream.fileName,
        mediaType: stream.mediaType,
        size: stream.byteSize,
        content: stream.content,
      });
      context.usage?.addTransfer("export_bytes", download.size);
      return { output: { download, etag: stream.etag, ...(draft === null ? {} : { draft: draft.id }) }, repo: stream.spaceId };
    } finally {
      await stream.close();
    }
  },
};
