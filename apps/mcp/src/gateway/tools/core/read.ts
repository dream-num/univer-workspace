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
    "Accepts only Sheet Units; use inspect for other Unit types. Read a range such as Summary!A3:I8, paging by whole rows with next.arguments. content selects both values and formulas (default), display, formula, style, or formula+style. Structured json always contains typed cells.",
  annotations: readOnlyAnnotations,
  inputSchema: sheetLensTarget.safeExtend({
    range: z.string().min(1),
    content: z.enum(["both", "display", "formula", "style", "formula+style"]).optional(),
    max: z.int().positive().optional(),
    json: z
      .boolean()
      .optional()
      .describe("Request typed JSON cells, also included in every structured result."),
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
