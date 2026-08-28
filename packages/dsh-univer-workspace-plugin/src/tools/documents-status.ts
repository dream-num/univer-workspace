/** Open and collaboration-status tools for Workspace documents. */

import { defineTool, type JsonValue } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { WorkspaceDocumentOpen } from "../shared/wire.ts";
import { assertWorktreeAccessible, resolveToolScope } from "./tool-scope.ts";
import { nonEmptyArgument, text } from "./documents-common.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

/** Register `univer_open` and `univer_status`. */
export function registerDocumentStatusTools(ctx: Context): () => void {
  const disposers = [
    registerUniverTool(ctx, defineTool({
      name: "univer_open",
      description: "Open a Univer document (by resourceId) to learn its unitId, unitType, and whether it is editable.",
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
        const document = await ctx.get("univerWorkspace")!.openDocument(resolved.userId, args.resourceId);
        return document;
      },
      // Keep identifiers in the structured result, but do not put a raw
      // resource UUID in the visible call card.
      presentCall: () => ({ card: "generic", title: "Open Workspace document", kind: "read" }),
    })),

    registerUniverTool(ctx, defineTool({
      name: "univer_status",
      description:
        "Read a remote Workspace document or Worktree collaboration status. Provide resourceId for a trunk Resource, or worktreeId for a draft/ready Worktree (resourceId may be omitted for a Worktree-local Unit). Call this before choosing a Unit or continuing prior work.",
      parameters: {
        resourceId: { type: "string" },
        worktreeId: { type: "string" },
        unitId: { type: "string", description: "Optional Unit filter inside the selected Worktree." },
      },
      output: {
        schema: { type: "json" },
        render: (_args, value: unknown) => text(JSON.stringify(value ?? {})),
      },
      async execute(args, exec) {
        const resolved = await resolveToolScope(ctx, exec);
        const resourceId = nonEmptyArgument(args.resourceId, "resourceId");
        const worktreeId = nonEmptyArgument(args.worktreeId, "worktreeId");
        const unitId = nonEmptyArgument(args.unitId, "unitId");
        if (resourceId === undefined && worktreeId === undefined && unitId === undefined) {
          throw new UniverError("univer_status requires resourceId, unitId, or worktreeId.", "INVALID_REQUEST");
        }

        // A trunk Unit id is a first-class identity in the Office-compatible
        // execution surface.  The Workspace product exposes a dedicated
        // unit→Resource bridge, so callers that already have `unitId` should
        // not be forced to rediscover the Resource id first.
        if (worktreeId === undefined && resourceId === undefined && unitId !== undefined) {
          const document = await ctx.get("univerWorkspace")!.resolveUnitResource(resolved.userId, unitId);
          const fileState = await ctx.get("univerWorkspace")!.getFileState(resolved.userId, document.resourceId);
          return {
            ...document,
            document: document as unknown as JsonValue,
            unit: document as unknown as JsonValue,
            fileState: fileState as unknown as JsonValue,
          };
        }

        // A Worktree-local Unit has a reserved resourceId before it is merged,
        // but that id is intentionally not visible through /api/resources.
        // Read the Worktree first and only resolve a product Resource when the
        // selected Unit is actually anchored in trunk.
        if (worktreeId !== undefined) {
          await assertWorktreeAccessible(ctx, resolved, worktreeId);
          const fileState = await ctx.get("univerWorkspace")!.getWorktreeFileState(resolved.userId, worktreeId);
          const worktree = fileState.worktrees.find((entry) => entry.worktreeId === worktreeId);
          if (worktree === undefined) {
            throw new UniverError("univer_status Worktree state is unavailable.", "WORKTREE_NOT_FOUND");
          }
          const selected = unitId === undefined
            ? resourceId === undefined
              ? worktree.units[0]
              : worktree.units.find((unit) => unit.resourceId === resourceId)
            : worktree.units.find((unit) => unit.unitId === unitId);
          if (unitId !== undefined && selected === undefined) {
            throw new UniverError("The requested Unit is not part of the selected Worktree.", "UNIT_NOT_FOUND");
          }
          if (resourceId !== undefined && selected === undefined) {
            throw new UniverError("The requested Resource is not part of the selected Worktree.", "WORKSPACE_NOT_FOUND");
          }
          if (resourceId !== undefined && selected !== undefined && selected.resourceId !== resourceId) {
            throw new UniverError("The requested Resource does not belong to the selected Unit.", "WORKSPACE_SCOPE_DENIED");
          }
          let document: WorkspaceDocumentOpen | null = null;
          if (selected !== undefined && selected.source === "trunk") {
            document = await ctx.get("univerWorkspace")!.openDocument(resolved.userId, selected.resourceId);
          } else if (resourceId !== undefined && selected === undefined) {
            // Keep the error above deterministic and avoid probing a Resource
            // that is not in this Worktree.
            throw new UniverError("The requested Resource is not part of the selected Worktree.", "WORKSPACE_NOT_FOUND");
          }
          return {
            ...(document === null ? {} : document),
            ...(selected === undefined ? {} : {
              resourceId: selected.resourceId,
              unitId: selected.unitId,
              unitType: selected.unitType,
              name: selected.name,
              editorMode: (selected.source === "worktree" && worktree.status === "draft" ? "edit" : "readOnly") as "edit" | "readOnly",
            }),
            worktreeId,
            document: document as unknown as JsonValue,
            unit: (selected ?? null) as unknown as JsonValue,
            fileState: fileState as unknown as JsonValue,
          };
        }

        // Without a Worktree, status is a trunk Resource operation.  The
        // explicit resourceId requirement is enforced after trimming so an
        // empty model argument cannot accidentally resolve a broad listing.
        const trunkResourceId = resourceId!;
        const document = await ctx.get("univerWorkspace")!.openDocument(resolved.userId, trunkResourceId);
        if (unitId !== undefined && unitId !== document.unitId) {
          throw new UniverError("The requested Unit does not belong to the selected Resource.", "UNIT_NOT_FOUND");
        }
        const fileState = await ctx.get("univerWorkspace")!.getFileState(resolved.userId, trunkResourceId);
        return {
          ...document,
          document: document as unknown as JsonValue,
          unit: document as unknown as JsonValue,
          fileState: fileState as unknown as JsonValue,
        };
      },
      presentCall: () => ({ card: "generic", title: "Read Workspace status", kind: "read" }),
    })),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
