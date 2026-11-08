import { WorkspaceAssetFeature } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { downloadSchema } from "../../staging/model.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { stagingStore } from "./staging-support.js";
import { worktreeInput } from "../core/space-support.js";
const inputSchema = z.object({ id: z.string(), worktree: worktreeInput });
export const assetDownloadTool: ToolDefinition = {
  name: "asset_download",
  toolset: "files",
  scope: "read",
  title: "Download a document asset",
  description:
    "Download a Unit-referenced asset in a Worktree. GET download.url to fetch the bytes. The private capability link expires in 15 minutes; keep it private.",
  inputSchema,
  outputSchema: z.object({ download: downloadSchema }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const input = inputSchema.parse(args);
    const store = stagingStore(context);
    const stream = await new WorkspaceAssetFeature(async () => context.http).downloadStream({
      assetId: input.id,
      worktreeId: input.worktree,
    });
    try {
      const download = await store.createDownload({
        owner: context.user.id,
        fileName: stream.fileName + assetExtension(stream.mediaType),
        mediaType: stream.mediaType,
        ...(stream.size === undefined ? {} : { size: stream.size }),
        content: stream.content,
      });
      context.usage?.addTransfer("export_bytes", download.size);
      return { output: { download }, repo: null };
    } finally {
      await stream.close();
    }
  },
};

function assetExtension(mediaType: string): string {
  switch (mediaType.split(";")[0]?.trim().toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    case "image/bmp":
      return ".bmp";
    case "image/avif":
      return ".avif";
    case "image/tiff":
      return ".tiff";
    case "image/x-icon":
      return ".ico";
    case "application/pdf":
      return ".pdf";
    default:
      return ".bin";
  }
}
