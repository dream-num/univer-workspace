/**
 * Team Space Issue tool.
 *
 * One tool whose `action` reads and operates Issues, mirroring `univer_worktree`. An Issue is a
 * request from the user's team; reading or commenting on it never changes Space files. Nothing
 * here needs approval: every action can be undone by another action.
 * @module dsh-univer-workspace-plugin/tools/issue
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { runIssueOperation, IssueOperationError } from "@univerjs/univer-workspace-agent-runtime/workspace-issue-operations";
import { UniverError } from "./errors.ts";
import { registerUniverTool } from "./presentation.ts";
import { resolveToolScope } from "./tool-scope.ts";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

/** Register the Issue tool. */
export function registerIssueTool(ctx: Context): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_issue",
      description:
        "Read and operate Team Space Issues: requests and problems the user's team recorded, addressed by Space and number (#12). Actions: list, get, create, update, comment, close, reopen. `get` returns the body, the linked files (with resourceId for univer_open / univer_worktree) and the whole discussion; read it before starting an Issue task. Issue writes are not idempotent: if a create or comment fails with an unknown result, `get` before repeating it. Never close an Issue unless the user asks.",
      parameters: {
        action: {
          type: "string",
          required: true,
          enum: ["list", "get", "create", "update", "comment", "close", "reopen"],
        },
        spaceId: {
          type: "string",
          description: "Team Space id. Defaults to the Space linked to this session.",
        },
        scope: {
          type: "string",
          enum: ["space", "mine"],
          description:
            "list only. `space` (default) lists one Space; `mine` lists across every Team Space the user belongs to, e.g. with assignee=me.",
        },
        number: { type: "integer", description: "Issue number, the N in #N." },
        state: { type: "string", enum: ["open", "closed", "all"], description: "list filter; default open." },
        assignee: { type: "string", description: "list filter: `me`, `none`, or a user id." },
        search: { type: "string", description: "list filter on title and body." },
        limit: { type: "integer" },
        title: { type: "string" },
        body: { type: "string", description: "Markdown. For comment, the comment text." },
        labels: { type: "array", items: { type: "string" }, description: "create: label names, or list filter." },
        assignees: { type: "array", items: { type: "string" }, description: "create: `me` or user ids." },
        resourceIds: { type: "array", items: { type: "string" }, description: "create: Univer files to link." },
        nodeIds: { type: "array", items: { type: "string" }, description: "create: other Nodes to link." },
        addLabels: { type: "array", items: { type: "string" } },
        removeLabels: { type: "array", items: { type: "string" } },
        addAssignees: { type: "array", items: { type: "string" } },
        removeAssignees: { type: "array", items: { type: "string" } },
        addResourceIds: { type: "array", items: { type: "string" } },
        removeResourceIds: { type: "array", items: { type: "string" } },
        addNodeIds: { type: "array", items: { type: "string" } },
        removeNodeIds: { type: "array", items: { type: "string" } },
        reason: { type: "string", enum: ["completed", "not_planned"], description: "close only; default completed." },
        comment: { type: "string", description: "close only: a final comment posted first." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true, const: true },
            operation: { type: "string", required: true, const: "issue" },
            result: { type: "json", required: true },
          },
        },
        render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
      },
      async execute(args, exec) {
        const scope = await resolveToolScope(ctx, exec);
        const service = ctx.get("univerWorkspace")!;
        const { userId } = scope;
        const spaceId = args.spaceId?.trim() || scope.spaceId;
        try {
          return await runIssueOperation(args, userId, spaceId, service);
        } catch (error) {
          if (error instanceof IssueOperationError) throw new UniverError(error.message, error.code, { cause: error });
          throw error;
        }
      },
      presentCall: (args: unknown) => {
        const value = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
        const action = typeof value.action === "string" ? value.action : "";
        const number = typeof value.number === "number" ? ` #${value.number}` : "";
        return { card: "generic", title: `issue ${action}${number}`, kind: action === "list" || action === "get" ? "read" : "execute" };
      },
    }),
  );
}
