/**
 * Worktree Unit authoring tool.
 *
 * This is the honest remote counterpart of dsh-univer-office's
 * `univer_unit create`.  Workspace exposes a POST create contract for a
 * Worktree-local Unit, but no delete/remove contract; the schema therefore
 * accepts `create` only until the product adds a reversible remove operation.
 * @module dsh-univer-workspace-plugin/tools/unit
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { resolveTargetSpace, resolveToolScope } from "./tool-scope.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

const unitTypeEnum = { type: "string" as const, enum: ["sheet", "doc", "slide", "board", "base"] as const };

/** Register the Worktree-local Unit tool. */
export function registerUnitTool(ctx: Context): () => void {
  const dispose = registerUniverTool(ctx, defineTool({
    name: "univer_unit",
    description:
      "Create a new sheet, doc, slide, board, or base Unit inside a draft Workspace Worktree. The target Space defaults to the calling agent's linked Space; provide another Space when the authenticated User has access to it. Workspace currently has no Unit remove endpoint, so action=create is the only supported action.",
    parameters: {
      action: { type: "string", required: true, enum: ["create"] },
      worktreeId: { type: "string", required: true },
      name: { type: "string", required: true },
      unitType: { ...unitTypeEnum, required: true },
      spaceId: { type: "string" },
      parentNodeId: { type: "string" },
      initialData: { type: "json" },
      idempotencyKey: { type: "string", description: "Optional stable key for retry-safe creation." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          unitId: { type: "string", required: true },
          resourceId: { type: "string", required: true },
          nodeId: { type: "string", required: true },
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
      render: (_args: unknown, value: unknown): ContentBlock[] => text(JSON.stringify(value ?? {})),
    },
    async execute(args, exec) {
      const resolved = await resolveToolScope(ctx, exec);
      const { userId } = resolved;
      const targetSpaceId = resolveTargetSpace(resolved, args.spaceId);
      if (args.worktreeId.trim() === "") throw new UniverError("univer_unit requires worktreeId.", "INVALID_REQUEST");
      if (args.name.trim() === "") throw new UniverError("univer_unit requires a non-empty name.", "INVALID_REQUEST");
      const idempotencyKey = args.idempotencyKey?.trim();
      if (args.idempotencyKey !== undefined && idempotencyKey === "") {
        throw new UniverError("univer_unit idempotencyKey must be non-empty.", "INVALID_REQUEST");
      }
      if (args.initialData !== undefined && (args.initialData === null || typeof args.initialData !== "object" || Array.isArray(args.initialData))) {
        throw new UniverError("univer_unit initialData must be a JSON object.", "INVALID_REQUEST");
      }
      const unit = await ctx.get("univerWorkspace")!.createWorktreeLocalUnit(userId, {
        worktreeId: args.worktreeId,
        name: args.name,
        unitType: args.unitType,
        targetSpaceId,
        targetParentNodeId: args.parentNodeId ?? null,
        ...(args.initialData === undefined ? {} : { initialData: args.initialData as Record<string, unknown> }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      });
      return unit;
    },
    presentCall: (args: unknown) => ({
      card: "generic",
      title: typeof args === "object" && args !== null && "name" in args
        ? `create Unit ${(args as { name?: unknown }).name ?? ""}`
        : "create Unit",
      kind: "execute",
    }),
  }));
  return () => dispose();
}
