/**
 * Discovery tools: list the User's Spaces, list a Space's documents, and open
 * a document.
 *
 * The calling agent's identity is resolved from `session.header.cwd` (the dsh
 * workspace id) through the space-links mapping, so a detached call without a
 * workspace fails closed.
 * @module dsh-univer-workspace-plugin/tools/discovery
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { WorkspaceSpace } from "../shared/wire.ts";
import { registerUniverTool } from "./presentation.ts";
import { resolveToolScope } from "./tool-scope.ts";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

interface RenderedWorkspaceSpace extends WorkspaceSpace {
  /** True only for the Space mechanically backing this DSH session. */
  readonly linked: boolean;
}

/** Keep the session boundary visible to the model, not just in structured JSON. */
export function renderSpaces(spaces: readonly RenderedWorkspaceSpace[]): ContentBlock[] {
  return text(
    spaces
      .map((s) => {
        const marker = s.linked ? ", linked to this session" : "";
        return `${s.name} (${s.type}, ${s.spaceId}${marker})`;
      })
      .join("\n") || "no spaces",
  );
}

/** Register the discovery tools. */
export function registerDiscoveryTools(ctx: Context): () => void {
  const disposers = [
    registerUniverTool(
      ctx,
      defineTool({
        name: "univer_spaces",
        description:
          "List the Univer Workspace Spaces the current User can access. Each Space is where documents live; select one before listing or creating documents.",
        parameters: {},
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              spaces: {
                type: "array",
                required: true,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    spaceId: { type: "string", required: true },
                    name: { type: "string", required: true },
                    type: { type: "string", required: true },
                    accessRole: { type: "string", required: true },
                    dshWorkspaceId: { type: "string", required: true },
                    linked: { type: "boolean", required: true },
                  },
                },
              },
            },
          },
          render: (_args, value: unknown) => {
            const spaces = ((value ?? {}) as { spaces?: RenderedWorkspaceSpace[] }).spaces ?? [];
            return renderSpaces(spaces);
          },
        },
        async execute(_args, exec) {
          const scope = await resolveToolScope(ctx, exec);
          const result = await ctx.get("univerWorkspace")!.listSpaces(scope.userId);
          return {
            spaces: result.spaces.map((s) => ({
              spaceId: s.spaceId,
              name: s.name,
              type: s.type,
              accessRole: s.accessRole,
              dshWorkspaceId: s.dshWorkspaceId,
              linked: s.spaceId === scope.spaceId,
            })),
          };
        },
        // Do not fall back to DSH's raw-argument card here: the only argument
        // is an authenticated scope that is not useful to a reader, and the
        // response already carries the human-readable Space names.
        presentCall: () => ({ card: "generic", title: "List Workspace spaces", kind: "read" }),
      }),
    ),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
