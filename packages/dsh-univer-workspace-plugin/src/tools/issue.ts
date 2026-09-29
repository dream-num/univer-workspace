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
import type { JsonValue } from "../json-value.ts";
import { WorkspaceApiError } from "../provider/api-errors.ts";
import type { IssueChange } from "../provider/issues-api.ts";
import { UniverError } from "./errors.ts";
import { registerUniverTool } from "./presentation.ts";
import { resolveToolScope } from "./tool-scope.ts";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

function invalid(message: string): UniverError {
  return new UniverError(message, "INVALID_REQUEST");
}

function nonEmpty(values: readonly string[] | undefined, name: string): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (values.some((value) => value.trim() === "")) throw invalid(`univer_issue ${name} must not contain empty values.`);
  return values;
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
        const wrap = async (result: Promise<unknown>) => {
          try {
            return { ok: true as const, operation: "issue" as const, result: (await result) as JsonValue };
          } catch (error) {
            // Workspace's generic 409 text says "changed concurrently", which would send the model
            // into a pointless retry when the Space simply is not a Team Space.
            if (error instanceof WorkspaceApiError && error.status === 409 && /team spaces/i.test(error.message)) {
              throw new UniverError(
                "Issues exist only in Team Spaces. Pass a Team Space id as spaceId (see univer_spaces), or use scope=mine.",
                "ISSUES_TEAM_SPACE_ONLY",
                { cause: error },
              );
            }
            throw error;
          }
        };
        const number = () => {
          if (args.number === undefined || !Number.isInteger(args.number) || args.number < 1) {
            throw invalid(`univer_issue ${args.action} requires a positive integer number.`);
          }
          return args.number;
        };
        const labelIds = async (names: readonly string[] | undefined) => {
          if (names === undefined || names.length === 0) return [];
          const known = new Map(
            (await service.listIssueLabels(userId, spaceId)).map((label) => [label.name.toLowerCase(), label.id]),
          );
          return names.map((name) => {
            const id = known.get(name.trim().toLowerCase());
            if (id === undefined) {
              throw new UniverError(
                `The Space has no Issue label named "${name}". Known labels: ${[...known.keys()].join(", ") || "none"}.`,
                "ISSUE_LABEL_NOT_FOUND",
              );
            }
            return id;
          });
        };
        const users = (values: readonly string[] | undefined) =>
          (values ?? []).map((value) => (value === "me" ? userId : value));
        const nodes = async (resourceIds: readonly string[] | undefined, nodeIds: readonly string[] | undefined) => [
          ...(nodeIds ?? []),
          ...(await Promise.all((resourceIds ?? []).map(async (id) => (await service.openDocument(userId, id)).nodeId))),
        ];

        switch (args.action) {
          case "list":
            return await wrap(
              service.listIssues(userId, {
                ...(args.scope === "mine" ? {} : { spaceId }),
                ...(args.state === undefined ? {} : { state: args.state }),
                ...(args.labels === undefined ? {} : { labels: args.labels }),
                ...(args.assignee === undefined ? {} : { assignee: args.assignee }),
                ...(args.search === undefined ? {} : { search: args.search }),
                ...(args.limit === undefined ? {} : { limit: args.limit }),
              }),
            );
          case "get":
            return await wrap(
              service.readIssue(userId, spaceId, number(), { timeline: true }).then((issue) => issue.view),
            );
          case "create": {
            if (args.title === undefined || args.title.trim() === "") {
              throw invalid("univer_issue create requires a title.");
            }
            return await wrap(
              (async () => {
                const change: IssueChange & { title: string } = {
                  title: args.title!,
                  ...(args.body === undefined ? {} : { body: args.body }),
                  ...(args.labels?.length ? { labelIds: await labelIds(args.labels) } : {}),
                  ...(args.assignees?.length ? { assigneeUserIds: users(args.assignees) } : {}),
                  ...(args.resourceIds?.length || args.nodeIds?.length
                    ? { nodeIds: await nodes(args.resourceIds, args.nodeIds) }
                    : {}),
                };
                return await service.createIssue(userId, spaceId, change);
              })(),
            );
          }
          case "update":
            return await wrap(
              (async () => {
                const n = number();
                const addLabels = nonEmpty(args.addLabels, "addLabels");
                const removeLabels = nonEmpty(args.removeLabels, "removeLabels");
                const changesSets = [
                  args.addLabels, args.removeLabels, args.addAssignees, args.removeAssignees,
                  args.addResourceIds, args.removeResourceIds, args.addNodeIds, args.removeNodeIds,
                ].some((values) => values !== undefined && values.length > 0);
                if (args.title === undefined && args.body === undefined && !changesSets) {
                  throw invalid("univer_issue update needs a title, body, or a label/assignee/file change.");
                }
                const change: { -readonly [K in keyof IssueChange]: IssueChange[K] } = {};
                if (args.title !== undefined) change.title = args.title;
                if (args.body !== undefined) change.body = args.body;
                if (changesSets) {
                  const { sets } = await service.readIssue(userId, spaceId, n, { timeline: false });
                  const merge = (current: readonly string[], add: readonly string[], remove: readonly string[]) => {
                    const drop = new Set(remove);
                    return [...new Set([...current, ...add])].filter((id) => !drop.has(id));
                  };
                  if (addLabels?.length || removeLabels?.length) {
                    change.labelIds = merge(sets.labelIds, await labelIds(addLabels), await labelIds(removeLabels));
                  }
                  if (args.addAssignees?.length || args.removeAssignees?.length) {
                    change.assigneeUserIds = merge(sets.assigneeUserIds, users(args.addAssignees), users(args.removeAssignees));
                  }
                  if (args.addResourceIds?.length || args.removeResourceIds?.length || args.addNodeIds?.length || args.removeNodeIds?.length) {
                    change.nodeIds = merge(
                      sets.nodeIds,
                      await nodes(args.addResourceIds, args.addNodeIds),
                      await nodes(args.removeResourceIds, args.removeNodeIds),
                    );
                  }
                }
                return await service.updateIssue(userId, spaceId, n, change);
              })(),
            );
          case "comment": {
            if (args.body === undefined || args.body.trim() === "") {
              throw invalid("univer_issue comment requires a non-empty body.");
            }
            return await wrap(service.commentOnIssue(userId, spaceId, number(), args.body));
          }
          case "close":
            return await wrap(
              (async () => {
                const n = number();
                if (args.comment !== undefined && args.comment.trim() !== "") {
                  await service.commentOnIssue(userId, spaceId, n, args.comment);
                }
                return await service.updateIssue(userId, spaceId, n, {
                  state: "closed",
                  stateReason: args.reason ?? "completed",
                });
              })(),
            );
          case "reopen":
            return await wrap(service.updateIssue(userId, spaceId, number(), { state: "open" }));
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
