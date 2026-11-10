/**
 * Version-matched Univer Facade API reference tool.
 *
 * This is intentionally local and read-only: the reference artifact is part
 * of the pinned `@univer-cli/api-reference` package, so no Workspace request
 * or user-provided code is involved.  It mirrors dsh-univer-office's
 * `univer_api` contract and keeps the result envelope stable for replayed
 * turns and tool cards.
 *
 * @module dsh-univer-workspace-plugin/tools/api
 */

import { ApiReferenceInputError, queryWorkspaceApi } from "@univerjs/univer-workspace-agent-runtime/api-reference";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { JsonValue } from "../json-value.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

const apiUnitEnum = {
  type: "string" as const,
  enum: ["sheet", "doc", "slide", "base", "board"] as const,
};

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

/** Register the read-only API reference tool. */
export function registerApiTool(ctx: Context): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_api",
      description:
        "Look up the pinned, version-matched Univer Facade API. Use find when the class or API label is unknown; use show for a known class, type, or exact Class.member label. Each query is independent and find is case-insensitive.",
      parameters: {
        action: {
          type: "string",
          required: true,
          enum: ["find", "show"],
          description: "find discovers API labels; show documents a known symbol or member.",
        },
        queries: {
          type: "array",
          required: true,
          items: { type: "string" },
          description:
            "One or more non-empty API terms, such as conditionalFormat, FRange, or FRange.setValue.",
        },
        unit: { ...apiUnitEnum, description: "Optional Unit filter for find." },
        limit: { type: "integer", description: "Optional positive maximum matches per find term." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true, const: true },
            operation: { type: "string", required: true, const: "api" },
            result: { type: "json", required: true },
          },
        },
        render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
      },
      async execute(args) {
        try {
          const response = await queryWorkspaceApi(args);
          return { ...response, result: response.result as JsonValue };
        } catch (error) {
          if (error instanceof ApiReferenceInputError)
            throw new UniverError(error.message, "INVALID_REQUEST");
          throw error;
        }
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Univer API ${args.action}: ${args.queries.join(", ")}`,
        kind: "read",
      }),
    }),
  );
}
