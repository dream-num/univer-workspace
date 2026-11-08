import { readFile } from "node:fs/promises";
import { z } from "zod";
import { typstCompileInput, opSpecs } from "../../../shared/executor-protocol.js";
import { executorTool } from "../executor-tool.js";
import { writeAnnotations } from "../definition.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";
import { stagingStore } from "./staging-support.js";

export const compileTypstTool = executorTool({
  name: "compile_typst",
  toolset: "files",
  scope: "write",
  title: "Compile a Typst bundle into a Doc",
  description:
    "Compile a ready typst-bundle ZIP with typst.json at its root into Facade JavaScript and diagnostics. To create a Doc in a pull request, set apply, worktree and space. Generate an idempotency_key before creation and reuse it with identical inputs on retry. Expanded ZIP limits are 256 entries, 4 MiB per file and 8 MiB total; created UnitData must fit 900 KiB.",
  annotations: writeAnnotations,
  inputSchema: z.object({
    bundle_upload_id: z.string().min(1),
    apply: z.boolean().optional(),
    worktree: z.string().min(1).optional(),
    space: repoInput.optional(),
    parent: z.string().min(1).optional(),
    idempotency_key: typstCompileInput.shape.idempotencyKey,
  }),
  op: opSpecs["typst.compile"],
  async request(args, context) {
    const input = typstCompileInput.parse({
      apply: args.apply,
      worktreeId: args.worktree,
      spaceId: args.space,
      parentNodeId: args.parent,
      idempotencyKey: args.idempotency_key,
    });
    await stagingStore(context).requireUpload(
      context.user.id,
      args.bundle_upload_id,
      "typst-bundle",
    );
    if (args.space !== undefined) input.spaceId = await resolveRepo(context, args.space);
    return stagingStore(context).withUpload(
      context.user.id,
      args.bundle_upload_id,
      "typst-bundle",
      async (_object, path) => {
        const bytes = await readFile(path);
        context.usage?.addTransfer("upload_bytes", bytes.length);
        return { input, bytes };
      },
    );
  },
});
