import { readFile, stat } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import {
  DEFAULT_WORKSHEET_ROW_COUNT,
  DEFAULT_WORKSHEET_COLUMN_COUNT,
  type IWorkbookData,
} from "@univerjs/core";
import {
  getHtmlViewUnitIds,
  MAX_HTML_VIEW_BYTES,
  isHtmlViewFilename,
  parseHtmlView,
} from "@univerjs/workspace-html-view";
import { resolveToolScope, resolveTargetSpace } from "./tool-scope.ts";
import { existingSessionPath } from "./workspace-path.ts";
import { registerUniverTool } from "./presentation.ts";
import type { JsonValue } from "../json-value.ts";

export function registerHtmlViewTool(ctx: Context): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_html_view",
      description:
        "Create a live .univer.html dashboard bound to existing Workspace Sheet Units. Read the univer-html-view skill. validate checks the HTML file and actual source worksheets; create publishes a separate Blob file to Workspace and returns its URL. It never edits source cells. Blob files do not use Unit Worktrees; revise by creating another file. Generation is performed by the agent using HTML/CSS and declarative bindings; scripts are not executed.",
      parameters: {
        action: { type: "string", required: true, enum: ["validate", "create"] },
        source: {
          type: "string",
          description: "Session-relative .univer.html source file for validate/create.",
        },
        name: { type: "string", description: "Name for create; .univer.html is added if missing." },
        spaceId: {
          type: "string",
          description: "Destination Space, defaults to current linked Space.",
        },
        parentNodeId: { type: "string", description: "Optional destination folder Node." },
        idempotencyKey: {
          type: "string",
          description:
            "Required for create. Reuse the same key only when retrying identical content and destination.",
        },
      },
      output: {
        schema: { type: "json" },
        render: (_args: unknown, value: unknown) => [{ type: "text", text: JSON.stringify(value) }],
      },
      async execute(args, exec): Promise<JsonValue> {
        const scope = await resolveToolScope(ctx, exec);
        const service = ctx.get("univerWorkspace")!;
        if (!args.source || !isHtmlViewFilename(args.source))
          throw new Error("source must be a .univer.html file.");
        const source = await existingSessionPath(exec, args.source);
        exec.signal?.throwIfAborted();
        if ((await stat(source.path)).size > MAX_HTML_VIEW_BYTES)
          throw new Error("HTML view exceeds 1 MiB.");
        const html = await readFile(source.path, { encoding: "utf8", signal: exec.signal });
        const parsed = parseHtmlView(html);
        const unitIds = getHtmlViewUnitIds(parsed);
        for (const unitId of unitIds) {
          const opened = await service.resolveUnitResource(scope.userId, unitId);
          if (opened.unitType !== "sheet" || opened.unitId !== unitId)
            throw new Error("Source must be a Sheet Unit.");
          const data = await service.exportUnitData(scope.userId, {
            scope: { kind: "trunk" },
            unitId,
            unitType: "sheet",
          });
          const workbook = data as IWorkbookData;
          for (const { reference } of parsed.bindings.filter(
            (binding) => binding.reference.unitId === unitId,
          )) {
            const sheet = Object.hasOwn(workbook.sheets, reference.sheetId)
              ? workbook.sheets[reference.sheetId]
              : undefined;
            if (!sheet) throw new Error(`Source worksheet not found: ${reference.sheetId}`);
            if (
              reference.row >= (sheet.rowCount ?? DEFAULT_WORKSHEET_ROW_COUNT) ||
              reference.col >= (sheet.columnCount ?? DEFAULT_WORKSHEET_COLUMN_COUNT)
            )
              throw new Error("Source cell is outside the worksheet.");
          }
        }
        if (args.action === "validate")
          return { valid: true, unitIds, bindingCount: parsed.bindings.length };
        if (!args.name?.trim() || !args.idempotencyKey?.trim())
          throw new Error("create requires name and idempotencyKey.");
        exec.signal?.throwIfAborted();
        return await service.uploadBlob(scope.userId, {
          signal: exec.signal,
          bytes: new TextEncoder().encode(html),
          declaredMediaType: "text/html",
          name: isHtmlViewFilename(args.name.trim())
            ? args.name.trim()
            : `${args.name.trim()}.univer.html`,
          idempotencyKey: args.idempotencyKey,
          spaceId: resolveTargetSpace(scope, args.spaceId),
          ...(args.parentNodeId ? { parentNodeId: args.parentNodeId } : {}),
        });
      },
      presentCall: (args) => ({
        card: "generic",
        title: `HTML view: ${args.action}`,
        kind: args.action === "create" ? "execute" : "read",
      }),
    }),
  );
}
