/**
 * Import/export tools: convert between Office files in the session workspace
 * and remote Univer Workspace Units.
 *
 * `univer_import` reads a file from the session's dsh workspace directory and
 * imports it as a Unit; `univer_export` exports a Unit to a file written back
 * into that directory. Paths are constrained to the session cwd.
 * @module dsh-univer-workspace-plugin/tools/exchange
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { ExchangeUnitType } from "../provider/exchange.ts";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

async function scope(ctx: Context, exec: ToolRunContext): Promise<{ userId: string; spaceId: string; cwd: string }> {
  const cwd = exec.agent?.session.header.cwd;
  if (cwd === undefined || cwd === "") throw new Error("univer tools require a calling agent with a workspace");
  const resolved = await ctx.univerWorkspace.resolveSpaceForSession(cwd);
  if (resolved === undefined) throw new Error("the calling agent's workspace is not linked to a Univer Workspace Space");
  return { ...resolved, cwd };
}

function sessionPath(cwd: string, file: string): string {
  const path = resolve(cwd, file);
  if (path !== cwd && !path.startsWith(cwd + "/")) {
    throw new Error("import/export path must stay inside the session workspace");
  }
  return path;
}

const unitTypeEnum = { type: "string" as const, enum: ["sheet", "doc", "slide", "base"] as const };

/** Register the import/export tools. */
export function registerExchangeTools(ctx: Context): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: "univer_import",
      description: "Import an Office file (xlsx/csv/tsv/docx/pptx) from the session workspace into a Univer Workspace Unit.",
      parameters: {
        type: { type: "string", required: true, enum: ["auto", "sheet", "doc", "slide", "base"] },
        file: { type: "string", required: true, description: "Path to the source file relative to the session workspace." },
        spaceId: { type: "string" },
        outputType: { type: "integer" },
      },
      output: {
        schema: { type: "object", properties: { status: { type: "string" }, unitID: { type: "string" }, jsonID: { type: "string" } }, additionalProperties: false },
        render: (_args, value: unknown) => {
          const record = (value ?? {}) as { status?: string; unitID?: string; jsonID?: string };
          return text(record.status === "done" ? `imported (unit ${record.unitID ?? record.jsonID ?? "?"})` : `import ${record.status ?? "unknown"}`);
        },
      },
      async execute(args, exec) {
        const { userId, cwd } = await scope(ctx, exec);
        const path = sessionPath(cwd, args.file);
        const bytes = new Uint8Array(await readFile(path));
        const result = await ctx.univerWorkspace.importFile(userId, {
          filename: path.split("/").pop() ?? "import",
          bytes,
          mediaType: "application/octet-stream",
          type: args.type as ExchangeUnitType | "auto",
          request: {
            fileID: "",
            outputType: (args.outputType === 2 ? 2 : 1) as 1 | 2,
            ...(args.spaceId === undefined ? {} : { spaceId: String(args.spaceId) }),
          },
        });
        return {
          status: result.status,
          unitID: result.import?.unitID ?? "",
          jsonID: result.import?.jsonID ?? "",
        };
      },
    })),

    ctx.tools.register(defineTool({
      name: "univer_export",
      description: "Export a Univer Workspace Unit to an Office file (xlsx/csv/docx/pptx) in the session workspace.",
      parameters: {
        type: { ...unitTypeEnum, required: true },
        unitID: { type: "string", required: true },
        format: { type: "string", required: true, enum: ["xlsx", "csv", "docx", "pptx"] },
        file: { type: "string", required: true, description: "Destination path relative to the session workspace." },
      },
      output: {
        schema: { type: "object", properties: { status: { type: "string" }, fileID: { type: "string" }, file: { type: "string" } }, additionalProperties: false },
        render: (_args, value: unknown) => {
          const record = (value ?? {}) as { status?: string; file?: string };
          return text(record.status === "done" ? `exported to ${record.file ?? "file"}` : `export ${record.status ?? "unknown"}`);
        },
      },
      async execute(args, exec) {
        const { userId, cwd } = await scope(ctx, exec);
        const result = await ctx.univerWorkspace.exportFile(userId, {
          type: args.type as ExchangeUnitType,
          request: { unitID: args.unitID, format: args.format as "xlsx" | "csv" | "docx" | "pptx" },
        });
        if (result.status !== "done" || result.export?.fileID === undefined) {
          throw new Error(result.message ?? "workspace export did not produce a file");
        }
        const bytes = await ctx.univerWorkspace.downloadFileBytes(userId, result.export.fileID);
        const path = sessionPath(cwd, args.file);
        await writeFile(path, bytes);
        return { status: result.status, fileID: result.export.fileID, file: args.file };
      },
    })),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
