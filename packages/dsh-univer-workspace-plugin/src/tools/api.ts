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

import { createStandardApiReference, type ApiReferenceUnit } from "@univer-cli/api-reference";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { JsonValue } from "../json-value.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

const reference = createStandardApiReference();

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
        if (args.queries.length === 0 || args.queries.some((query) => query.trim() === "")) {
          throw new UniverError(
            "univer_api requires at least one non-empty query.",
            "INVALID_REQUEST",
          );
        }
        if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1)) {
          throw new UniverError("univer_api limit must be a positive integer.", "INVALID_REQUEST");
        }
        const result =
          args.action === "show"
            ? reference.show(args.queries)
            : reference.find({
                terms: args.queries,
                ...(args.unit === undefined ? {} : { unit: args.unit as ApiReferenceUnit }),
                ...(args.limit === undefined ? {} : { limit: args.limit }),
              });
        return {
          ok: true as const,
          operation: "api" as const,
          result: result as unknown as JsonValue,
        };
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Univer API ${args.action}: ${args.queries.join(", ")}`,
        kind: "read",
      }),
    }),
  );
}
