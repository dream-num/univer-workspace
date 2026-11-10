import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { markdownCompileInput, opSpecs } from "../../../shared/executor-protocol.js";
import { executorTool } from "../executor-tool.js";
import { writeAnnotations } from "../definition.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";
import { stagingStore } from "./staging-support.js";

const op = opSpecs["markdown.compile"];
export const compileMarkdownTool = executorTool({
  name: "compile_markdown",
  toolset: "files",
  scope: "write",
  title: "Compile Markdown into a Doc",
  description:
    "Compile Markdown without applying, or apply it to a pull request. To create, set apply, worktree and space. Generate an idempotency_key before creation and reuse it on retry. To update, set apply, worktree, unit, source_map and explicit blocks; replacement blocks must keep their IDs. Optional assets_upload_id is a ready markdown-assets ZIP with relative image paths. Compile-only returns Facade JavaScript. Save the returned sourceMap for updates and exports.",
  annotations: writeAnnotations,
  inputSchema: z.object({
    markdown: markdownCompileInput.shape.markdown,
    assets_upload_id: z.string().min(1).optional(),
    title: z.string().optional(),
    apply: z.boolean().optional(),
    worktree: z.string().min(1).optional(),
    space: repoInput.optional(),
    parent: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
    source_map: markdownCompileInput.shape.sourceMap,
    blocks: markdownCompileInput.shape.blockIds,
    idempotency_key: markdownCompileInput.shape.idempotencyKey.describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }),
  op,
  async request(args, context) {
    // Validate modes before resolving repositories or consuming an upload.
    const input = markdownCompileInput.parse({
      markdown: args.markdown,
      title: args.title,
      apply: args.apply,
      worktreeId: args.worktree,
      spaceId: args.space,
      parentNodeId: args.parent,
      unitId: args.unit,
      sourceMap: args.source_map,
      blockIds: args.blocks,
      idempotencyKey: args.idempotency_key,
    });
    if (args.assets_upload_id !== undefined)
      await stagingStore(context).requireUpload(
        context.user.id,
        args.assets_upload_id,
        "markdown-assets",
      );
    if (args.space !== undefined) input.spaceId = await resolveRepo(context, args.space);
    if (args.assets_upload_id === undefined) return { input, bytes: new Uint8Array() };
    return stagingStore(context).withUpload(
      context.user.id,
      args.assets_upload_id,
      "markdown-assets",
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
