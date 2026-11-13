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

export const outlineTool = executorTool({
  name: "outline",
  toolset: "core",
  scope: "read",
  title: "Outline a Sheet",
  description:
    "Accepts only Sheet Units; use inspect for other Unit types. Map sheets, regions, tables and columns, zoom with at, and continue with next.arguments. budget limits text characters within each scope.",
  annotations: readOnlyAnnotations,
  inputSchema: sheetLensTarget.safeExtend({
    at: z.string().optional(),
    from: z.string().optional(),
    depth: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    budget: z.int().positive().optional(),
  }),
  outputSchema: sheetLensToolOutput,
  op: opSpecs["content.sheet-lens"],
  request: ({ unit, trunk, worktree, json: _json, ...options }) => ({
    input: {
      unitId: unit,
      scope: sheetLensScope({ unit, trunk, worktree }),
      request: { op: "outline" as const, ...options },
    },
  }),
  response: (result, args) => sheetLensResponse(result.output, args),
});
