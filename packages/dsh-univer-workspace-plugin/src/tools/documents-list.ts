/** Discovery/list tools for Workspace folders and resources. */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { listOptions, listOutput, type ListArguments } from "@univerjs/univer-workspace-agent-runtime/workspace-spaces";
import { resolveTargetSpace, resolveToolScope } from "./tool-scope.ts";
import { text, unitTypeEnum } from "./documents-common.ts";
import { registerUniverTool } from "./presentation.ts";

const resourceKindEnum = {
  type: "string" as const,
  enum: ["univer", "blob", "folder", "all"] as const,
};

const listSchema = {
  spaceId: {
    type: "string" as const,
    description:
      "Optional. Omit to list the Space linked to this session; an explicit value may select any Space accessible to the authenticated User.",
  },
  parentNodeId: { type: "string" as const },
  recursive: { type: "boolean" as const },
  query: { type: "string" as const },
  resourceKind: resourceKindEnum,
  unitType: unitTypeEnum,
} as const;

const listOutputSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    spaceId: { type: "string" as const, required: true },
    documents: {
      type: "array" as const,
      required: true,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          nodeId: { type: "string" as const, required: true },
          name: { type: "string" as const, required: true },
          parentNodeId: {
            oneOf: [{ type: "string" as const }, { type: "null" as const }] as const,
            required: true,
          },
          hasChildren: { type: "boolean" as const, required: true },
          updatedAt: {
            oneOf: [{ type: "string" as const }, { type: "null" as const }] as const,
            required: true,
          },
          resourceId: { type: "string" as const, required: true },
          resourceKind: {
            type: "string" as const,
            enum: ["univer", "blob"] as const,
            required: true,
          },
          unitType: { type: "string" as const },
          mediaType: { type: "string" as const },
          byteSize: { type: "number" as const },
          availability: { type: "string" as const },
          accessRole: { type: "string" as const, required: true },
          nodeCapabilities: { type: "json" as const },
          resourceCapabilities: { type: "json" as const },
        },
      },
    },
    folders: {
      type: "array" as const,
      required: true,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          nodeId: { type: "string" as const, required: true },
          name: { type: "string" as const, required: true },
          parentNodeId: {
            oneOf: [{ type: "string" as const }, { type: "null" as const }] as const,
            required: true,
          },
          hasChildren: { type: "boolean" as const, required: true },
          updatedAt: {
            oneOf: [{ type: "string" as const }, { type: "null" as const }] as const,
            required: true,
          },
          accessRole: { type: "string" as const, required: true },
          nodeCapabilities: { type: "json" as const },
        },
      },
    },
  },
} as const;

const executeList = async (ctx: Context, args: ListArguments, exec: ToolRunContext) => {
  const resolved = await resolveToolScope(ctx, exec);
  const spaceId = resolveTargetSpace(resolved, args.spaceId);
  const documents = await ctx
    .get("univerWorkspace")!
    .listDocuments(resolved.userId, spaceId, listOptions(args));
  return listOutput(documents, spaceId);
};

const renderList = (_args: ListArguments, value: unknown) => {
  const record = (value ?? {}) as {
    documents?: { name: string; unitType?: string; resourceKind?: string; resourceId: string }[];
    folders?: { name: string }[];
  };
  const lines = [
    ...(record.folders ?? []).map((folder) => `📁 ${folder.name}`),
    ...(record.documents ?? []).map(
      (document) =>
        `${document.name} (${document.resourceKind ?? "resource"}${document.unitType === undefined ? "" : `/${document.unitType}`}, ${document.resourceId})`,
    ),
  ];
  return text(lines.join("\n") || "no documents");
};

/** Register `univer_documents` and its compact `univer_list` alias. */
export function registerDocumentListTools(ctx: Context): () => void {
  const disposers = [
    registerUniverTool(
      ctx,
      defineTool({
        name: "univer_documents",
        description:
          "List Nodes in a Univer Workspace Space. Omit spaceId to use the Space linked to this session, or provide another Space the authenticated User can access. By default this includes nested folders and both Univer and Blob resources. Use parentNodeId, recursive, query, resourceKind, or unitType to narrow discovery.",
        parameters: listSchema,
        output: { schema: listOutputSchema, render: renderList },
        execute: (args, exec) => executeList(ctx, args, exec),
        presentCall: () => ({ card: "generic", title: "List Workspace documents", kind: "read" }),
      }),
    ),
    registerUniverTool(
      ctx,
      defineTool({
        name: "univer_list",
        description:
          "Alias of univer_documents. Lists the linked Space by default and accepts any other Space accessible to the authenticated User. Supports the same filters as univer_documents.",
        parameters: listSchema,
        output: { schema: listOutputSchema, render: renderList },
        execute: (args, exec) => executeList(ctx, args, exec),
        presentCall: () => ({ card: "generic", title: "List Workspace documents", kind: "read" }),
      }),
    ),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
