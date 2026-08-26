/**
 * The `univer_edit` tool: read or write a Worktree Unit's data by executing
 * Univer Facade API code in the headless collaboration runtime.
 *
 * A read runs against a trunk or draft Unit; a write runs only in Worktree
 * scope and commits the resulting changeset to the draft, leaving merge to
 * the explicit `univer_worktree ready/merge` flow with user approval.
 * @module dsh-univer-workspace-plugin/tools/edit
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { WorkspaceRuntimeScope } from "../runtime/target.js";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

async function scope(ctx: Context, exec: ToolRunContext): Promise<{ userId: string; spaceId: string }> {
  const cwd = exec.agent?.session.header.cwd;
  if (cwd === undefined || cwd === "") throw new Error("univer tools require a calling agent with a workspace");
  const resolved = await ctx.get("univerWorkspace")!.resolveSpaceForSession(cwd);
  if (resolved === undefined) throw new Error("the calling agent's workspace is not linked to a Univer Workspace Space");
  return resolved;
}

const unitTypeEnum = { type: "string" as const, enum: ["sheet", "doc", "slide", "board", "base"] as const };

/** Register the edit tool. */
export function registerEditTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: "univer_edit",
    description:
      "Execute Univer Facade API code against a Workspace Unit in the headless collaboration runtime. mode=read inspects a trunk or draft Unit; mode=write edits a Worktree draft Unit and commits the resulting changeset for later review/merge.",
    parameters: {
      mode: { type: "string", required: true, enum: ["read", "write"] },
      worktreeId: { type: "string" },
      unitId: { type: "string", required: true },
      unitType: { ...unitTypeEnum, required: true },
      revision: { type: "integer", required: true },
      code: { type: "string", required: true },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value: unknown) => {
        const record = (value ?? {}) as { committed?: boolean; value?: unknown };
        const summary = record.value === undefined ? "" : JSON.stringify(record.value);
        return text(record.committed ? `edited and committed: ${summary}` : `read: ${summary}`);
      },
    },
    async execute(args, exec) {
      const { userId } = await scope(ctx, exec);
      const runtimeScope: WorkspaceRuntimeScope =
        args.worktreeId === undefined ? { kind: "trunk" } : { kind: "worktree", worktreeId: args.worktreeId };
      if (args.mode === "read") {
        const value = await ctx.get("univerWorkspace")!.readUnit(userId, {
          scope: runtimeScope,
          unitId: args.unitId,
          unitType: args.unitType,
          revision: args.revision,
          code: args.code,
        });
        return { committed: false, value };
      }
      return await ctx.get("univerWorkspace")!.editUnit(userId, {
        scope: runtimeScope,
        unitId: args.unitId,
        unitType: args.unitType,
        revision: args.revision,
        code: args.code,
      });
    },
  }));
}
