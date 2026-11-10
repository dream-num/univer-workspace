import { readFile } from "node:fs/promises";
import { z } from "zod";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { svgCompileInput, opSpecs } from "../../../shared/executor-protocol.js";
import { executorTool } from "../executor-tool.js";
import { writeAnnotations } from "../definition.js";
import { stagingStore } from "./staging-support.js";

export const compileSvgTool = executorTool({
  name: "compile_svg",
  toolset: "files",
  scope: "write",
  title: "Compile SVG onto a Slide page",
  description:
    "Compile SVG into Slide Facade code. Text is measured with real fonts by the renderer; deployments without a renderer use a built-in text size estimate; estimate_text_size: true uses a built-in estimate instead (less accurate, no renderer call). To apply, set page (1-based), worktree and unit. worktree or unit implies apply: true when apply is omitted; explicit apply: false rejects them. add overlays instead of replacing. This content commit has no idempotency key. After workspace-result-unknown, read back with inspect before retrying. Optional assets_upload_id names a ready svg-assets ZIP (256 entries, 4 MiB per file, 8 MiB total).",
  annotations: writeAnnotations,
  inputSchema: z.object({
    svg: svgCompileInput.shape.svg,
    assets_upload_id: z.string().min(1).optional(),
    estimate_text_size: z.boolean().optional(),
    page: svgCompileInput.shape.page,
    add: z.boolean().optional(),
    apply: z.boolean().optional(),
    worktree: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
  }),
  op: opSpecs["svg.compile"],
  async request(args, context) {
    const input = svgCompileInput.parse({
      svg: args.svg,
      estimateTextSize: args.estimate_text_size,
      page: args.page,
      add: args.add,
      apply: args.apply ?? (args.worktree !== undefined || args.unit !== undefined),
      worktreeId: args.worktree,
      unitId: args.unit,
    });
    if (args.assets_upload_id === undefined) return { input, bytes: new Uint8Array() };
    return stagingStore(context).withUpload(
      context.user.id,
      args.assets_upload_id,
      "svg-assets",
      async (_object, path) => {
        const bytes = await readFile(path);
        if (bytes.length === 0)
          throw workspaceError(
            "workspace-argument-invalid",
            "Assets upload must contain a ZIP archive.",
          );
        context.usage?.addTransfer("upload_bytes", bytes.length);
        return { input, bytes };
      },
    );
  },
});
