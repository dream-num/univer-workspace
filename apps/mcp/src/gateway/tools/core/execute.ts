import { z } from "zod";
import { codeInput, opSpecs } from "../../../shared/executor-protocol.js";
import { writeAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { acceptForkAddress, worktreeOrForkInput } from "./space-support.js";

export const executeTool = acceptForkAddress(executorTool({
  name: "execute",
  toolset: "core",
  scope: "write",
  title: "Run code on a file",
  description:
    "Run Univer Facade code in a pull request's Worktree and commit the changes. Content writes require a draft Worktree; before writing to an already-ready pull request, use pr_ready with undo: true. Read-only code does not require reopening. Read back with inspect to verify changes; the notice from whoami, or without one the server instructions, says what happens to the pull request next.",
  annotations: writeAnnotations,
  inputSchema: z.object({ worktree: worktreeOrForkInput, unit: z.string().min(1), code: codeInput }),
  op: opSpecs["content.execute"],
  request: ({ worktree, unit, code }) => ({ input: { worktreeId: worktree, unitId: unit, code } }),
}));
