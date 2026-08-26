/**
 * Document discovery and authoring tools: list a Space's documents, open one,
 * and create a new Univer document.
 * @module dsh-univer-workspace-plugin/tools/documents
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
  const resolved = await ctx.univerWorkspace.resolveSpaceForSession(cwd);
  if (resolved === undefined) throw new Error("the calling agent's workspace is not linked to a Univer Workspace Space");
  return resolved;
}

const unitTypeEnum = { type: "string" as const, enum: ["sheet", "doc", "slide", "board", "base"] as const };

/** Register document tools. */
export function registerDocumentTools(ctx: Context): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: "univer_documents",
      description: "List the documents (Nodes) inside one Univer Workspace Space. Pass the spaceId from univer_spaces.",
      parameters: {
        spaceId: { type: "string", required: true },
      },
      output: {
        schema: {
          type: "object",
          properties: {
            spaceId: { type: "string" },
            documents: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  nodeId: { type: "string" },
                  name: { type: "string" },
                  resourceId: { type: "string" },
                  unitId: { type: "string" },
                  unitType: { type: "string" },
                  accessRole: { type: "string" },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        render: (_args, value: unknown) => {
          const record = (value ?? {}) as { documents?: { name: string; unitType: string; unitId: string }[] };
          const docs = record.documents ?? [];
          return text(docs.map(d => `${d.name} (${d.unitType}, unit ${d.unitId})`).join("\n") || "no documents");
        },
      },
      async execute(args, exec) {
        const { userId } = await scope(ctx, exec);
        const documents = await ctx.univerWorkspace.listDocuments(userId, args.spaceId);
        return {
          spaceId: args.spaceId,
          documents: documents
            .filter(d => d.resourceId !== null && d.unitId !== null && d.unitType !== null)
            .map(d => ({
              nodeId: d.nodeId,
              name: d.name,
              resourceId: d.resourceId as string,
              unitId: d.unitId as string,
              unitType: d.unitType as string,
              accessRole: d.accessRole,
            })),
        };
      },
    })),

    ctx.tools.register(defineTool({
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
        render: (_args, value: unknown) => {
          const record = (value ?? {}) as { name?: string; unitType?: string; editorMode?: string; unitId?: string };
          return text(`${record.name ?? "document"} (${record.unitType ?? "?"}, unit ${record.unitId ?? "?"}) — ${record.editorMode === "readOnly" ? "read-only" : "editable"}`);
        },
      },
      async execute(args, exec) {
        const { userId } = await scope(ctx, exec);
        return await ctx.univerWorkspace.openDocument(userId, args.resourceId);
      },
    })),

    ctx.tools.register(defineTool({
      name: "univer_create",
      description: "Create a new Univer document (sheet/doc/slide/board/base) inside a Space.",
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
          const record = (value ?? {}) as { unitId?: string };
          return text(`created document (unit ${record.unitId ?? "?"})`);
        },
      },
      async execute(args, exec) {
        const { userId } = await scope(ctx, exec);
        return await ctx.univerWorkspace.createDocument(userId, {
          spaceId: args.spaceId,
          parentNodeId: args.parentNodeId ?? null,
          name: args.name,
          unitType: args.unitType,
        });
      },
    })),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
