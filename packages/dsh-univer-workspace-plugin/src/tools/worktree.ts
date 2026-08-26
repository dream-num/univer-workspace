/**
 * Worktree lifecycle tool and the merge/discard approval hook.
 *
 * Mirrors dsh-univer-office's `univer_worktree` shape: one tool whose `action`
 * drives create/ready/merge/discard, with merge and discard forced through
 * user approval via the `tools/pre-execute` waterfall.
 * @module dsh-univer-workspace-plugin/tools/worktree
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Register the Worktree tool and its approval hook. */
export function registerWorktreeTools(ctx: Context): () => void {
  const disposeTool = ctx.tools.register(defineTool({
    name: "univer_worktree",
    description: "Create or transition an isolated Univer Worktree for review. Actions: create, ready, reopen, merge, discard. Merge and discard require user approval.",
    parameters: {
      action: { type: "string", required: true, enum: ["create", "ready", "reopen", "merge", "discard"] },
      name: { type: "string" },
      summary: { type: "string" },
      worktreeId: { type: "string" },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          state: { type: "string" },
        },
        additionalProperties: false,
      },
      render: (_args, value: unknown) => {
        const record = (value ?? {}) as { name?: string; state?: string };
        return text(`${record.name ?? "worktree"} — ${record.state ?? "unknown"}`);
      },
    },
    async execute(args, exec) {
      const { userId } = await scope(ctx, exec);
      if (args.action === "create") {
        return await ctx.get("univerWorkspace")!.createWorktree(userId, { name: args.name ?? "Univer worktree", summary: args.summary ?? null });
      }
      if (args.worktreeId === undefined) {
        throw new Error(`univer_worktree ${args.action} requires worktreeId`);
      }
      switch (args.action) {
        case "ready":
          return await ctx.get("univerWorkspace")!.markWorktreeReady(userId, args.worktreeId);
        case "merge":
          return await ctx.get("univerWorkspace")!.mergeWorktree(userId, args.worktreeId);
        case "discard":
          return await ctx.get("univerWorkspace")!.discardWorktree(userId, args.worktreeId);
        case "reopen":
          // reopen is not yet exposed by the Workspace API provider; a draft
          // Worktree stays editable without it. Fail closed rather than fake it.
          throw new Error("univer_worktree reopen is not supported yet");
      }
    },
    presentCall: (args: unknown) => {
      const action = isRecord(args) && typeof args.action === "string" ? args.action : "";
      return { card: "generic", title: `worktree ${action}`, kind: "execute" };
    },
  }));

  const disposeHook = ctx.on("tools/pre-execute", (exec, next) => {
    if (exec.name !== "univer_worktree" || !isRecord(exec.arguments)) return next();
    const action = exec.arguments.action;
    if (action !== "merge" && action !== "discard") return next();
    return Promise.resolve({
      kind: "ask",
      reason: action === "merge"
        ? "Merging publishes the selected Univer worktree into trunk."
        : "Discarding permanently removes the selected Univer worktree changes.",
    });
  });

  return () => {
    disposeHook();
    disposeTool();
  };
}
