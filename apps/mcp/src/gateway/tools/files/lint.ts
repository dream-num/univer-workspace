import { z } from "zod";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { lintOutput } from "../../../shared/pdf-lint-schema.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { worktreeInput } from "../core/space-support.js";

export const lintTool = executorTool({
  name: "lint",
  toolset: "files",
  scope: "read",
  title: "Lint Slide layout",
  description:
    "Lint the layout of a Slide Unit in a Worktree: text that leaves its page, escapes its container or overlaps other text. Other Unit types are rejected. pages selects Slide pages or page IDs, for example 1,3-5,cover, or all. Returns a report with coverage (checked pages and rules) and findings, each with page, rule, detail and boxes.",
  annotations: readOnlyAnnotations,
  inputSchema: z.object({
    unit: z.string().min(1),
    worktree: worktreeInput,
    pages: z
      .string()
      .describe("Slide pages or page IDs, for example 1,3-5,cover, or all.")
      .optional(),
  }),
  outputSchema: lintOutput,
  op: opSpecs["render.lint"],
  request: ({ unit, worktree, pages }) => ({
    input: { worktreeId: worktree, unitId: unit, pages },
  }),
});
