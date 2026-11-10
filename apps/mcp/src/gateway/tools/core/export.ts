import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { z } from "zod";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { downloadSchema } from "../../staging/model.js";
import { executorTool } from "../executor-tool.js";
import { readOnlyAnnotations } from "../definition.js";
import { stagingStore } from "../files/staging-support.js";

const officeMediaTypes = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const exportTool = executorTool({
  name: "export",
  toolset: "core",
  scope: "read",
  title: "Export an Office file",
  description:
    "Export a pull request file as xlsx, docx or pptx. Return a private download link valid for 15 minutes. If the conversion outlasts the server's synchronous wait (30 seconds by default), returns a job_id with status running; poll job_get until succeeded or failed. Reuse idempotency_key with the same arguments on retry to avoid a second export; different arguments return workspace-idempotency-conflict. The RPC result is capped at 128 MiB.",
  annotations: readOnlyAnnotations,
  inputSchema: z.object({
    worktree: z.string().min(1),
    unit: z.string().min(1),
    format: z.enum(["xlsx", "docx", "pptx"]),
    idempotency_key: opSpecs["exchange.import"].input.shape.idempotencyKey.optional().describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }),
  outputSchema: z.object({
    download: downloadSchema,
    type: opSpecs["exchange.export"].output.shape.type,
  }),
  op: opSpecs["exchange.export"],
  job: { tool: "export", key: (args) => args.idempotency_key },
  request: ({ worktree, unit, format }) => ({
    input: { worktreeId: worktree, unitId: unit, format },
  }),
  async response({ output, bytes }, args, context) {
    const download = await stagingStore(context).createDownload({
      owner: context.user.id,
      fileName: `${output.name}.${args.format}`,
      mediaType: officeMediaTypes[args.format],
      size: bytes.length,
      content: (async function* () {
        yield bytes;
      })(),
    });
    context.usage?.addTransfer("export_bytes", bytes.length);
    return { output: { download, type: output.type } };
  },
});
