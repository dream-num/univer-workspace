import { z } from "zod";
import { opSpecs, markdownExportInput } from "../../../shared/executor-protocol.js";
import { downloadSchema } from "../../staging/model.js";
import { executorTool } from "../executor-tool.js";
import { readOnlyAnnotations } from "../definition.js";
import { stagingStore } from "./staging-support.js";

const op = opSpecs["markdown.export"];
export const exportMarkdownTool = executorTool({
  name: "export_markdown",
  toolset: "files",
  scope: "read",
  title: "Export current Doc blocks as Markdown",
  description:
    "Read current native Doc blocks as Markdown, a refreshed sourceMap and private asset download links valid for 15 minutes. Like the CLI, requires the source_map from the last successful compile or export and distinct explicit blocks; a hand-built map is rejected, and a Doc never compiled from Markdown has none, so read it with inspect or read-only execute instead. Output uses Univer directive Markdown (::heading, :span{...}), not GitHub Markdown; convert it before handing it to the user as plain Markdown. No resource bytes are inlined.",
  annotations: readOnlyAnnotations,
  inputSchema: z.object({
    worktree: z.string().min(1),
    unit: z.string().min(1),
    source_map: markdownExportInput.shape.sourceMap,
    blocks: markdownExportInput.shape.blockIds,
  }),
  outputSchema: op.output.extend({
    assets: z.array(z.object({ path: z.string(), download: downloadSchema })),
  }),
  op,
  request: ({ worktree, unit, source_map, blocks }) => ({
    input: { worktreeId: worktree, unitId: unit, sourceMap: source_map, blockIds: blocks },
  }),
  async response({ output, bytes }, _args, context) {
    const assets = [];
    for (const asset of output.assets) {
      if (asset.offset + asset.size > bytes.length)
        throw new Error("Invalid executor asset range.");
      const data = bytes.subarray(asset.offset, asset.offset + asset.size);
      const download = await stagingStore(context).createDownload({
        owner: context.user.id,
        fileName: asset.path,
        mediaType: asset.mimeType,
        size: data.length,
        content: (async function* () {
          yield data;
        })(),
      });
      context.usage?.addTransfer("export_bytes", data.length);
      assets.push({ path: asset.path, download });
    }
    return { output: { ...output, assets } };
  },
});
