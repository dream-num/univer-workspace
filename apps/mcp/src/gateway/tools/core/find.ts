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

export const findTool = executorTool({
  name: "find",
  toolset: "core",
  scope: "read",
  title: "Find Sheet cells",
  description:
    "Accepts only Sheet Units; use inspect for other Unit types. Locate terms in values (default) or formulas. case enables case-sensitive matching, sheets restricts sheet names, and next.arguments continues the hits.",
  annotations: readOnlyAnnotations,
  inputSchema: sheetLensTarget.safeExtend({
    terms: z.array(z.string().min(1)).min(1),
    in: z.enum(["values", "formulas"]).optional(),
    case: z.boolean().optional(),
    sheets: z.array(z.string()).optional(),
    from: z.string().optional(),
    max: z.int().positive().optional(),
  }),
  outputSchema: sheetLensToolOutput,
  op: opSpecs["content.sheet-lens"],
  request: ({ unit, trunk, worktree, case: caseSensitive, ...options }) => ({
    input: {
      unitId: unit,
      scope: sheetLensScope({ unit, trunk, worktree }),
      request: {
        op: "find" as const,
        ...options,
        in: options.in ?? "values",
        caseSensitive: caseSensitive ?? false,
      },
    },
  }),
  response: (result, args) => sheetLensResponse(result.output, args),
});
