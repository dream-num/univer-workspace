import { z } from "zod";
import { codeInput, opSpecs } from "../../../shared/executor-protocol.js";
import { writeAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { worktreeInput } from "./space-support.js";

export const executeTool = executorTool({
  name: "execute",
  toolset: "core",
  scope: "write",
  title: "Run code on a file",
  description:
    "Run Univer Facade code in a pull request's Worktree and commit the changes. Content writes require a draft Worktree; before writing to an already-ready pull request, use pr_ready with undo: true. Read-only code does not require reopening. Read back with inspect to verify changes; leave them in draft unless the user explicitly requests completion or review.",
  annotations: writeAnnotations,
  inputSchema: z.object({ worktree: worktreeInput, unit: z.string().min(1), code: codeInput }),
  op: opSpecs["content.execute"],
  request: ({ worktree, unit, code }) => ({ input: { worktreeId: worktree, unitId: unit, code } }),
});
