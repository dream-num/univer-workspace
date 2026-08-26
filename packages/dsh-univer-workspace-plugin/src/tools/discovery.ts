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

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

/** Resolve the calling agent's `{ userId, spaceId }` for a tool execution. */
async function toolScope(ctx: Context, exec: ToolRunContext): Promise<{ userId: string; spaceId: string }> {
  const cwd = toolWorkspaceCwd(exec);
  const resolved = await ctx.univerWorkspace.resolveSpaceForSession(cwd);
  if (resolved === undefined) {
    throw new Error("the calling agent's workspace is not linked to a Univer Workspace Space");
  }
  return resolved;
}

/** Resolve the calling agent's working directory or fail closed. */
function toolWorkspaceCwd(exec: ToolRunContext): string {
  const cwd = exec.agent?.session.header.cwd;
  if (cwd === undefined || cwd === "") {
    throw new Error("univer tools require a calling agent with a workspace");
  }
  return cwd;
}

/** Register the discovery tools. */
export function registerDiscoveryTools(ctx: Context): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: "univer_spaces",
      description: "List the Univer Workspace Spaces the current User can access. Each Space is where documents live; select one before listing or creating documents.",
      parameters: {},
      output: {
        schema: { type: "object", properties: { spaces: { type: "array", items: { type: "object", properties: { spaceId: { type: "string" }, name: { type: "string" }, type: { type: "string" }, accessRole: { type: "string" } }, additionalProperties: false } } }, additionalProperties: false },
        render: (_args, value: unknown) => {
          const spaces = ((value ?? {}) as { spaces?: WorkspaceSpace[] }).spaces ?? [];
          return text(spaces.map(s => `${s.name} (${s.type}, ${s.spaceId})`).join("\n") || "no spaces");
        },
      },
      async execute(_args, exec) {
        const { userId } = await toolScope(ctx, exec);
        const result = await ctx.univerWorkspace.listSpaces(userId);
        return { spaces: result.spaces.map(s => ({ spaceId: s.spaceId, name: s.name, type: s.type, accessRole: s.accessRole })) };
      },
    })),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
