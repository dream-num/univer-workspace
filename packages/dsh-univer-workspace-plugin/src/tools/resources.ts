/**
 * Bundled visual-resource library tool.
 *
 * This mirrors dsh-univer-office's `univer_resources` surface using the
 * version-pinned CLI resource-library package.  The manifest is copied into
 * the packed plugin by the build (rather than embedded in the JavaScript
 * bundle); cache and export destinations are always below the calling DSH
 * session workspace.
 *
 * @module dsh-univer-workspace-plugin/tools/resources
 */

import { runResourceOperation, ResourceOperationError } from "@univerjs/univer-workspace-agent-runtime/workspace-resource-library";
import { SessionPathError } from "@univerjs/univer-workspace-agent-runtime/workspace-session-path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { JsonValue } from "../json-value.ts";
import { fileURLToPath } from "node:url";
import { resolveToolScope } from "./tool-scope.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

const MANIFEST_PATH = fileURLToPath(new URL("./resource-manifest.json", import.meta.url));

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

/** Register the bundled, read-only resource-library tool. */
export function registerResourcesTool(ctx: Context): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_resources",
      description:
        "Discover, read, export, and cache the version-pinned bundled SVG resources used by Univer content generation. Resource handles are stable within the shipped manifest; this is separate from Workspace product Resources.",
      parameters: {
        action: {
          type: "string",
          required: true,
          enum: ["registries", "find", "read", "export", "clear-cache"],
          description: "Resource-library operation.",
        },
        queries: {
          type: "array",
          items: { type: "string" },
          description: "Non-empty search terms for find.",
        },
        registries: {
          type: "array",
          items: { type: "string" },
          description: "Optional registry ids for find.",
        },
        limit: { type: "integer", description: "Optional positive result limit for find." },
        handle: { type: "string", description: "One resource handle for read." },
        handles: {
          type: "array",
          items: { type: "string" },
          description: "Resource handles for export.",
        },
        output: { type: "string", description: "Session-relative output directory for export." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true, const: true },
            operation: { type: "string", required: true, const: "resources" },
            result: { type: "json", required: true },
          },
        },
        render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
      },
      async execute(args, exec) {
        const { cwd } = await resolveToolScope(ctx, exec);
        try {
          return await runResourceOperation(args, cwd, MANIFEST_PATH, exec.signal) as { ok: true; operation: "resources"; result: JsonValue };
        } catch (error) {
          if (error instanceof ResourceOperationError || error instanceof SessionPathError) {
            throw new UniverError(error.message, error.code, { cause: error });
          }
          throw error;
        }
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Univer resources: ${args.action}`,
        kind: args.action === "export" || args.action === "clear-cache" ? "execute" : "read",
        ...(args.output === undefined ? {} : { locations: [{ path: args.output }] }),
      }),
    }),
  );
}
