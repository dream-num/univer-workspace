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
    "Run Univer Facade code in a pull request's draft Worktree and commit the changes. Read back with inspect before marking ready.",
  annotations: writeAnnotations,
  inputSchema: z.object({ worktree: worktreeInput, unit: z.string().min(1), code: codeInput }),
  op: opSpecs["content.execute"],
  request: ({ worktree, unit, code }) => ({ input: { worktreeId: worktree, unitId: unit, code } }),
});
