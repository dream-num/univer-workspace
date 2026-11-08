import { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { downloadSchema } from "../../staging/model.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { stagingStore } from "./staging-support.js";
const inputSchema = z.object({ resource: z.string() });
export const blobDownloadTool: ToolDefinition = {
  name: "blob_download",
  toolset: "files",
  scope: "read",
  title: "Download an uploaded file",
  description:
    "Return a private capability download link valid for 15 minutes and the quoted ETag required by blob_replace. GET download.url to fetch the bytes; keep the link private.",
  inputSchema,
  outputSchema: z.object({ download: downloadSchema, etag: z.string() }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { resource } = inputSchema.parse(args);
    const store = stagingStore(context);
    const stream = await new WorkspaceBlobFeature(async () => context.http).downloadStream(
      resource,
    );
    try {
      const download = await store.createDownload({
        owner: context.user.id,
        fileName: stream.fileName,
        mediaType: stream.mediaType,
        size: stream.byteSize,
        content: stream.content,
      });
      context.usage?.addTransfer("export_bytes", download.size);
      return { output: { download, etag: stream.etag }, repo: stream.spaceId };
    } finally {
      await stream.close();
    }
  },
};
