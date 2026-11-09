import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { inspectionOptions, opSpecs } from "../../../shared/executor-protocol.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { worktreeInput } from "./space-support.js";

export const inspectTool = executorTool({
  name: "inspect",
  toolset: "core",
  scope: "read",
  title: "Inspect file content",
  description:
    "Read structured content from trunk or a Worktree. Range requires worksheet (id:, name:, or index:1) and selectors such as A1:B2. Narrow oversized requests; pagination is unavailable.",
  annotations: readOnlyAnnotations,
  inputSchema: inspectionOptions.extend({
    unit: z.string().min(1),
    trunk: z.boolean().optional(),
    worktree: worktreeInput.optional(),
  }),
  op: opSpecs["content.inspect"],
  request: ({ unit, trunk, worktree, ...options }) => {
    if ((trunk === true) === (worktree !== undefined))
      throw workspaceError(
        "workspace-inspect-scope-required",
        "Specify exactly one of trunk: true or worktree.",
      );
    return {
      input: {
        ...options,
        unitId: unit,
        scope:
          worktree === undefined
            ? { kind: "trunk" as const }
            : { kind: "worktree" as const, worktreeId: worktree },
      },
    };
  },
});
