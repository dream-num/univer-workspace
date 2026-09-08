/** Creation tools for new Workspace documents. */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { JsonValue } from "../json-value.ts";
import { resolveTargetSpace, resolveToolScope } from "./tool-scope.ts";
import { text, unitTypeEnum } from "./documents-common.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

/** Register `univer_new` and `univer_create`. */
export function registerDocumentCreationTools(ctx: Context): () => void {
  const disposers = [
    // `univer_new` is the Office tool's name for starting a document. A
    // remote Workspace document is created in an explicit Space, so it is a
    // compatibility alias of `univer_create` with the same structured result.
    registerUniverTool(
      ctx,
      defineTool({
        name: "univer_new",
        description:
          "Create a new typed Univer Workspace document directly in the Space trunk. This immediately publishes its directory entry. For agent drafting and review, prefer univer_worktree action=create followed by univer_unit action=create.",
        parameters: {
          spaceId: { type: "string", required: true },
          name: { type: "string", required: true },
          unitType: { ...unitTypeEnum, required: true },
          parentNodeId: { type: "string" },
        },
        output: {
          schema: { type: "json" },
          render: (_args, value: unknown) => text(JSON.stringify(value ?? {})),
        },
        async execute(args, exec) {
          const resolved = await resolveToolScope(ctx, exec);
          const spaceId = resolveTargetSpace(resolved, args.spaceId);
          if (args.name.trim() === "")
            throw new UniverError(
              "univer_new requires a non-empty document name.",
              "INVALID_REQUEST",
            );
          return (await ctx.get("univerWorkspace")!.createDocument(resolved.userId, {
            spaceId,
            parentNodeId: args.parentNodeId ?? null,
            name: args.name,
            unitType: args.unitType,
          })) as unknown as JsonValue;
        },
        presentCall: (args) => ({
          card: "generic",
          title: `Create Workspace document: ${args.name}`,
          kind: "execute",
        }),
      }),
    ),

    registerUniverTool(
      ctx,
      defineTool({
        name: "univer_create",
        description: "Create a new Univer document (sheet/doc/slide/board/base) directly in the Space trunk. For agent drafting and review, prefer univer_worktree action=create followed by univer_unit action=create.",
        parameters: {
          spaceId: { type: "string", required: true },
          name: { type: "string", required: true },
          unitType: { ...unitTypeEnum, required: true },
          parentNodeId: { type: "string" },
        },
        output: {
          schema: {
            type: "object",
            properties: {
              resourceId: { type: "string" },
              unitId: { type: "string" },
              nodeId: { type: "string" },
            },
            additionalProperties: false,
          },
          render: (_args, value: unknown) => {
            // Preserve resourceId and unitId for replay-safe viewer projection.
            return text(JSON.stringify(value ?? {}));
          },
        },
        async execute(args, exec) {
          const resolved = await resolveToolScope(ctx, exec);
          const spaceId = resolveTargetSpace(resolved, args.spaceId);
          if (args.name.trim() === "")
            throw new UniverError(
              "univer_create requires a non-empty document name.",
              "INVALID_REQUEST",
            );
          return await ctx.get("univerWorkspace")!.createDocument(resolved.userId, {
            spaceId,
            parentNodeId: args.parentNodeId ?? null,
            name: args.name,
            unitType: args.unitType,
          });
        },
        presentCall: (args) => ({
          card: "generic",
          title: `Create Workspace document: ${args.name}`,
          kind: "execute",
        }),
      }),
    ),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
