/**
 * Create draft Units and manage reversible deletion intent in a Workspace Worktree.
 * @module dsh-univer-workspace-plugin/tools/unit
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { resolveToolScope } from "./tool-scope.ts";
import { runUnitOperation, UnitOperationError } from "@univerjs/univer-workspace-agent-runtime/workspace-unit-operations";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

const unitTypeEnum = {
  type: "string" as const,
  enum: ["sheet", "doc", "slide", "board", "base"] as const,
};

/** Register the Worktree-local Unit tool. */
export function registerUnitTool(ctx: Context): () => void {
  const dispose = registerUniverTool(
    ctx,
    defineTool({
      name: "univer_unit",
      description:
        "Manage documents (Units) inside a draft Workspace Worktree. create requires name and unitType; the target Space defaults to the agent's linked Space. remove requires unitId and marks it for deletion at merge: existing documents go to Trash and new draft documents are never published. restore requires unitId and undoes this draft deletion intent; it does not restore Trash. Ready Worktrees must be reopened before changing deletion intent. No action here merges the Worktree.",
      parameters: {
        action: { type: "string", required: true, enum: ["create", "remove", "restore"] },
        worktreeId: { type: "string", required: true },
        name: { type: "string" },
        unitType: { ...unitTypeEnum },
        unitId: {
          type: "string",
          description: "Required for remove or restore; use the Unit ID from Worktree detail.",
        },
        spaceId: { type: "string" },
        parentNodeId: { type: "string" },
        initialData: { type: "json" },
        idempotencyKey: {
          type: "string",
          description: "Optional stable key for retry-safe creation.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            unitId: { type: "string", required: true },
            resourceId: { type: "string", required: true },
            nodeId: { type: "json", required: true, description: "Node ID, or null if the node no longer exists." },
            source: { type: "string", required: true },
            name: { type: "string", required: true },
            unitType: { type: "string", required: true },
            target: { type: "json", required: true },
            draftHeadRevision: { type: "integer", required: true },
            change: { type: "string", required: true },
            mergeResult: { type: "string", required: true },
            activationState: { type: "string", required: true },
          },
        },
        render: (_args: unknown, value: unknown): ContentBlock[] =>
          text(JSON.stringify(value ?? {})),
      },
      async execute(args, exec) {
        const resolved = await resolveToolScope(ctx, exec);
        const { userId } = resolved;
        const service = ctx.get("univerWorkspace")!;
        try {
          return await runUnitOperation(args, resolved.spaceId, {
            setWorktreeUnitRemoved: (worktreeId, unitId, removed) => service.setWorktreeUnitRemoved(userId, worktreeId, unitId, removed),
            createWorktreeLocalUnit: (input) => service.createWorktreeLocalUnit(userId, input),
          });
        } catch (error) {
          if (error instanceof UnitOperationError) throw new UniverError(error.message, error.code, { cause: error });
          throw error;
        }
      },
      presentCall: (args: unknown) => {
        const input = args as { action?: string; name?: string; unitId?: string } | null;
        return {
          card: "generic",
          title: `${input?.action ?? "create"} Unit ${input?.name ?? input?.unitId ?? ""}`,
          kind: "execute",
        };
      },
    }),
  );
  return () => dispose();
}
