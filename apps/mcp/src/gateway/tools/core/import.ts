import { pullUrl, pullSpaceId } from "@univerjs/univer-workspace-client-core/product";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { executorTool } from "../executor-tool.js";
import { writeAnnotations } from "../definition.js";
import { stagingStore } from "../files/staging-support.js";
import { repoInput, resolveRepo } from "./issue-support.js";
import { worktreeFeature, spaceFeature } from "./pr-support.js";

const op = opSpecs["exchange.import"];
export const importTool = executorTool({
  name: "import",
  toolset: "core",
  scope: "write",
  title: "Import an Office file",
  description:
    "Import a ready office-import upload into a pull request. Generate an idempotency_key and reuse it with the same upload on retry. Converted UnitData must fit 900 KiB. Conversion has a 30-second budget; check state before retrying an unknown write.",
  annotations: writeAnnotations,
  inputSchema: z.object({
    upload_id: z.string().min(1),
    worktree: z.string().min(1),
    space: repoInput,
    type: op.input.shape.type,
    name: z.string().optional(),
    parent: z.string().optional(),
    idempotency_key: op.input.shape.idempotencyKey,
  }),
  outputSchema: op.output.extend({ url: z.url() }),
  op,
  async request(args, context) {
    const store = stagingStore(context);
    await store.requireUpload(context.user.id, args.upload_id, "office-import");
    const spaceId = await resolveRepo(context, args.space);
    return store.withUpload(
      context.user.id,
      args.upload_id,
      "office-import",
      async (object, path) => {
        const bytes = await readFile(path);
        context.usage?.addTransfer("upload_bytes", bytes.length);
        return {
          bytes,
          input: {
            worktreeId: args.worktree,
            spaceId,
            fileName: object.fileName,
            idempotencyKey: args.idempotency_key,
            ...(args.type === undefined ? {} : { type: args.type }),
            ...(args.name === undefined ? {} : { name: args.name }),
            ...(args.parent === undefined ? {} : { parentNodeId: args.parent }),
          },
        };
      },
    );
  },
  async response({ output }, _args, context) {
    const worktree = await worktreeFeature(context).get(output.worktreeId);
    const spaceId = await pullSpaceId(spaceFeature(context), worktree);
    return {
      output: { ...output, url: pullUrl(context.identityOrigin, worktree, output.unitId, spaceId) },
      repo: spaceId ?? null,
    };
  },
});
