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
import { assertWorktreeAccessible, resolveToolScope } from "./tool-scope.ts";
import { worktreeSummaryFromDetail } from "../provider/workspace-api.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Register the Worktree tool and its approval hook. */
export function registerWorktreeTools(ctx: Context): () => void {
  const disposeTool = registerUniverTool(ctx, defineTool({
    name: "univer_worktree",
    description: "Create or transition an isolated Univer Worktree for review. Actions: create, ready, reopen, merge, discard. Create requires resourceId so the draft has a document to edit; pass the resourceId returned by univer_create or univer_open. Merge and discard require user approval.",
    parameters: {
      action: { type: "string", required: true, enum: ["create", "ready", "reopen", "merge", "discard"] },
      name: { type: "string" },
      summary: { type: "string" },
      worktreeId: { type: "string" },
      resourceId: { type: "string" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          name: { type: "string", required: true },
          summary: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
          kind: { type: "string", enum: ["user", "team"], required: true },
          teamSpace: {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", required: true },
                  type: { type: "string", const: "team", required: true },
                  name: { type: "string", required: true },
                },
              },
            ],
            required: true,
          },
          visibility: { type: "string", enum: ["private", "space"], required: true },
          state: { type: "string", enum: ["draft", "ready", "merging", "merged", "discarded"], required: true },
          creator: {
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", required: true },
                  username: { type: "string", required: true },
                  displayName: { type: "string", required: true },
                  avatarUrl: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
                },
              },
            ],
            required: true,
          },
          unitCount: { type: "integer", required: true },
          processedAt: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
          createdAt: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
          updatedAt: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
          capabilities: {
            type: "object",
            additionalProperties: false,
            properties: {
              review: { type: "boolean", required: true },
              editDraft: { type: "boolean", required: true },
              addUnit: { type: "boolean", required: true },
              changeVisibility: { type: "boolean", required: true },
              markReady: { type: "boolean", required: true },
              reopen: { type: "boolean", required: true },
              merge: { type: "boolean", required: true },
              discard: { type: "boolean", required: true },
            },
          },
        },
      },
      render: (_args, value: unknown) => {
        // Keep the complete structured result visible to the conversation
        // projector, just like dsh-univer-office's operationOutput. The model
        // and replayed turn cards need the generated worktree id.
        return text(JSON.stringify(value ?? {}));
      },
    },
    async execute(args, exec) {
      const resolved = await resolveToolScope(ctx, exec);
      const { userId } = resolved;
      if (args.action === "create") {
        if (args.resourceId === undefined || args.resourceId.trim() === "") {
          throw new UniverError(
            "univer_worktree create requires resourceId from univer_create or univer_open.",
            "INVALID_REQUEST",
          );
        }
        if (args.name !== undefined && args.name.trim() === "") {
          throw new UniverError("univer_worktree create requires a non-empty name.", "INVALID_REQUEST");
        }
        const document = await ctx.get("univerWorkspace")!.openDocument(userId, args.resourceId);
        const worktree = await ctx.get("univerWorkspace")!.createWorktree(userId, { name: args.name ?? "Univer worktree", summary: args.summary ?? null });
        const added = await ctx.get("univerWorkspace")!.addWorktreeTrunkUnit(userId, worktree.id, args.resourceId);
        // The create response is intentionally a zero-unit summary.  Fetch the
        // authoritative detail after the add and verify that the exact mapped
        // Unit is present before returning a success card; never synthesize a
        // unitCount or descriptor locally.
        const detail = await ctx.get("univerWorkspace")!.getWorktreeDetail(userId, worktree.id);
        const registered = detail.units.find((unit) => unit.unitId === added.unitId);
        if (registered === undefined || registered.resourceId !== args.resourceId) {
          throw new UniverError(
            "The Workspace Worktree was created but its Unit was not registered.",
            "WORKTREE_RESPONSE_INVALID",
          );
        }
        return worktreeSummaryFromDetail(detail);
      }
      if (args.worktreeId === undefined) {
        throw new UniverError(`univer_worktree ${args.action} requires worktreeId.`, "INVALID_REQUEST");
      }
      if (args.worktreeId.trim() === "") {
        throw new UniverError(`univer_worktree ${args.action} requires worktreeId.`, "INVALID_REQUEST");
      }
      await assertWorktreeAccessible(ctx, resolved, args.worktreeId);
      switch (args.action) {
        case "ready":
          return await ctx.get("univerWorkspace")!.markWorktreeReady(userId, args.worktreeId);
        case "merge":
          return await ctx.get("univerWorkspace")!.mergeWorktree(userId, args.worktreeId);
        case "discard":
          return await ctx.get("univerWorkspace")!.discardWorktree(userId, args.worktreeId);
        case "reopen":
          return await ctx.get("univerWorkspace")!.reopenWorktree(userId, args.worktreeId);
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
