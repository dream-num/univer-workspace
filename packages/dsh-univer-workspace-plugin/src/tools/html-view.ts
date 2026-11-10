import { requireBlobIdempotencyKey } from "./blob-input.ts";
import { readFile } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { IWorkbookData } from "@univerjs/core";
import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import { validateHtmlView } from "@univerjs/univer-workspace-agent-runtime/workspace-html-view";
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
        "Validate or create a live .univer.html page bound to existing Workspace Sheet Units. Read the univer-html-view skill. validate checks the HTML file and actual source worksheets; create publishes a new Blob file and returns its Workspace URL. To revise an existing page, use univer_blob download to obtain its HTML and ETag, validate the revised template here, then use univer_blob replace to preserve its identity and URL. Blob files publish immediately without Unit Worktrees. This tool never edits source cells. Use HTML binding attributes for text and controls, or window.univerBinding for JavaScript data access. validate checks declarative references; JavaScript references are authorized at runtime.",
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
            "Required for create: 16–200 ASCII letters, digits, underscores or hyphens (for example a UUID). Reuse only when retrying identical content and destination.",
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
        const html = await readFile(source.path, { encoding: "utf8", signal: exec.signal });
        const validation = await validateHtmlView(html, async (unitId) => {
          const opened = await service.resolveUnitResource(scope.userId, unitId);
          if (opened.unitType !== "sheet" || opened.unitId !== unitId) throw new Error("Source must be a Sheet Unit.");
          return await service.exportUnitData(scope.userId, { scope: { kind: "trunk" }, unitId, unitType: "sheet" }) as IWorkbookData;
        }, exec.signal);
        if (args.action === "validate") return validation;
        if (!args.name?.trim()) throw new Error("create requires name.");
        const idempotencyKey = requireBlobIdempotencyKey(args.idempotencyKey);
        const origin = ctx.get("workspaceAuth")?.effectiveOrigin();
        if (!origin) throw new Error("Workspace origin is unavailable.");
        const name = isHtmlViewFilename(args.name.trim())
          ? args.name.trim()
          : `${args.name.trim()}.univer.html`;
        exec.signal?.throwIfAborted();
        const result = await service.uploadBlob(scope.userId, {
          bytes: new TextEncoder().encode(html),
          name,
          originalFilename: name,
          idempotencyKey,
          spaceId: resolveTargetSpace(scope, args.spaceId),
          parentNodeId: args.parentNodeId ?? null,
        });
        return {
          ...result,
          workspaceUrl: new URL(`/nodes/${encodeURIComponent(result.nodeId)}`, origin).href,
        };
      },
      presentCall: (args) => ({
        card: "generic",
        title: `HTML view: ${args.action}`,
        kind: args.action === "create" ? "execute" : "read",
      }),
    }),
  );
}
