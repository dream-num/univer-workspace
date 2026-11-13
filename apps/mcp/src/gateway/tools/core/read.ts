import { z } from "zod";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import {
  sheetLensTarget,
  sheetLensScope,
  sheetLensResponse,
  sheetLensToolOutput,
} from "./sheet-lens-support.js";

export const readTool = executorTool({
  name: "read",
  toolset: "core",
  scope: "read",
  title: "Read Sheet cells",
  description:
    "Accepts only Sheet Units; use inspect for other Unit types. Read a range with its sheet name, such as Orders!A1:J12, paging by whole rows with next.arguments. Use find to locate values instead of reading pages. content selects both values and formulas (default), display, formula, style, or formula+style. max is at most 2,000 cells. json: true includes typed cells.",
  annotations: readOnlyAnnotations,
  inputSchema: sheetLensTarget.safeExtend({
    range: z.string().min(1),
    content: z.enum(["both", "display", "formula", "style", "formula+style"]).optional(),
    max: z
      .int()
      .positive()
      .max(2000)
      .optional()
      .describe("Maximum cells per page, 1 to 2,000; default 500."),
  }),
  outputSchema: sheetLensToolOutput,
  op: opSpecs["content.sheet-lens"],
  request: ({ unit, trunk, worktree, range, content, max }) => ({
    input: {
      unitId: unit,
      scope: sheetLensScope({ unit, trunk, worktree }),
      request: {
        op: "read" as const,
        range,
        content: content ?? "both",
        ...(max === undefined ? {} : { max }),
      },
    },
  }),
  response: (result, args) => sheetLensResponse(result.output, args),
});
