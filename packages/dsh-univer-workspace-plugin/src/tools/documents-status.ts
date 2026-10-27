/** Open and collaboration-status tools for Workspace documents. */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { assertWorktreeAccessible, resolveToolScope } from "./tool-scope.ts";
import { text } from "./documents-common.ts";
import { runDocumentStatus, StatusOperationError } from "@univerjs/univer-workspace-agent-runtime/workspace-status";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

/** Register `univer_open` and `univer_status`. */
export function registerDocumentStatusTools(ctx: Context): () => void {
  const disposers = [
    registerUniverTool(
      ctx,
      defineTool({
        name: "univer_open",
        description:
          "Open a Univer document (by resourceId) to learn its unitId, unitType, and whether it is editable.",
        parameters: {
          resourceId: { type: "string", required: true },
        },
        output: {
          schema: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              resourceId: { type: "string" },
              unitId: { type: "string" },
              unitType: { type: "string" },
              name: { type: "string" },
              spaceId: { type: "string" },
              accessRole: { type: "string" },
              editorMode: { type: "string" },
            },
            additionalProperties: false,
          },
          render: (_args, value: unknown): ContentBlock[] => {
            // Emit the canonical value as JSON: the model reads the structured
            // document descriptor, and the viewer turn-definition parses it to
            // open the floating document window.
            return text(JSON.stringify(value));
          },
        },
        async execute(args, exec) {
          const resolved = await resolveToolScope(ctx, exec);
          const document = await ctx
            .get("univerWorkspace")!
            .openDocument(resolved.userId, args.resourceId);
          return document;
        },
        // Keep identifiers in the structured result, but do not put a raw
        // resource UUID in the visible call card.
        presentCall: () => ({ card: "generic", title: "Open Workspace document", kind: "read" }),
      }),
    ),

    registerUniverTool(
      ctx,
      defineTool({
        name: "univer_status",
        description:
          "Read a remote Workspace document or Worktree collaboration status. Provide resourceId for a trunk Resource, or worktreeId for a draft/ready Worktree (resourceId may be omitted for a Worktree-local Unit). Call this before choosing a Unit or continuing prior work.",
        parameters: {
          resourceId: { type: "string" },
          worktreeId: { type: "string" },
          unitId: {
            type: "string",
            description: "Optional Unit filter inside the selected Worktree.",
          },
        },
        output: {
          schema: { type: "json" },
          render: (_args, value: unknown) => text(JSON.stringify(value ?? {})),
        },
        async execute(args, exec) {
          const resolved = await resolveToolScope(ctx, exec);
          const service = ctx.get("univerWorkspace")!;
          try {
            return await runDocumentStatus(args, {
              resolveUnitResource: (id) => service.resolveUnitResource(resolved.userId, id),
              openDocument: (id) => service.openDocument(resolved.userId, id),
              getFileState: (id) => service.getFileState(resolved.userId, id),
              getWorktreeFileState: (id) => service.getWorktreeFileState(resolved.userId, id),
              assertWorktreeAccessible: (id) => assertWorktreeAccessible(ctx, resolved, id),
            });
          } catch (error) {
            if (error instanceof StatusOperationError) throw new UniverError(error.message, error.code, { cause: error });
            throw error;
          }
        },
        presentCall: () => ({ card: "generic", title: "Read Workspace status", kind: "read" }),
      }),
    ),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
