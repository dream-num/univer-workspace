import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { printPdfOutput } from "../../../shared/pdf-lint-schema.js";
import { downloadSchema } from "../../staging/model.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { worktreeInput } from "../core/space-support.js";
import { stagingStore } from "./staging-support.js";

export const printPdfTool = executorTool({
  name: "print_pdf",
  toolset: "files",
  scope: "read",
  title: "Print a Unit to PDF",
  description:
    "Print a Sheet, Doc or Slide from trunk or a Worktree to PDF; Base Units are rejected. Returns a private download link valid for 15 minutes with the page count. If the print outlasts the server's synchronous wait (30 seconds by default), returns a job_id with status running; poll job_get until succeeded or failed. Reuse idempotency_key with the same arguments on retry to avoid a second print; different arguments return workspace-idempotency-conflict. The renderer result is capped at 128 MiB.",
  annotations: readOnlyAnnotations,
  inputSchema: z.object({
    unit: z.string().min(1),
    trunk: z.boolean().optional(),
    worktree: worktreeInput.optional(),
    idempotency_key: opSpecs["exchange.import"].input.shape.idempotencyKey.optional(),
  }),
  outputSchema: printPdfOutput
    .pick({ unitId: true, unitType: true, pageCount: true })
    .extend({ download: downloadSchema }),
  op: opSpecs["render.printPdf"],
  job: { tool: "print_pdf", key: (args) => args.idempotency_key },
  request: ({ unit, trunk, worktree }) => {
    if (trunk === true && worktree !== undefined)
      throw workspaceError(
        "workspace-argument-invalid",
        "trunk cannot be used together with worktree.",
      );
    if (trunk !== true && worktree === undefined)
      throw workspaceError(
        "workspace-print-pdf-scope-required",
        "Workspace PDF printing requires worktree or trunk: true.",
      );
    return {
      input: {
        unitId: unit,
        scope:
          worktree === undefined
            ? { kind: "trunk" as const }
            : { kind: "worktree" as const, worktreeId: worktree },
      },
    };
  },
  async response({ output, bytes }, _args, context) {
    const download = await stagingStore(context).createDownload({
      owner: context.user.id,
      fileName: output.name.toLowerCase().endsWith(".pdf") ? output.name : `${output.name}.pdf`,
      mediaType: output.mediaType,
      size: bytes.length,
      content: (async function* () {
        yield bytes;
      })(),
    });
    context.usage?.addTransfer("export_bytes", bytes.length);
    return {
      output: {
        unitId: output.unitId,
        unitType: output.unitType,
        pageCount: output.pageCount,
        download,
      },
    };
  },
});
