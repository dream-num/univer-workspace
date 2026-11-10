/** Original Team Space Issue behavior, shared by the two Agent hosts. */
import type { JsonValue } from './json-value.js';
import { WorkspaceApiError } from './api-errors.js';
import type { IssueChange, IssueDetailView, IssueListView, IssueSets, IssueSummaryView, ListIssuesQuery } from './issues-api.js';

export class IssueOperationError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) { super(message, options); this.name = 'IssueOperationError'; }
}
export interface IssueArguments {
  action: 'list' | 'get' | 'create' | 'update' | 'comment' | 'close' | 'reopen';
  spaceId?: string; scope?: 'space' | 'mine'; number?: number; state?: 'open' | 'closed' | 'all';
  assignee?: string; search?: string; limit?: number; title?: string; body?: string;
  labels?: readonly string[]; assignees?: readonly string[]; resourceIds?: readonly string[]; nodeIds?: readonly string[];
  addLabels?: readonly string[]; removeLabels?: readonly string[]; addAssignees?: readonly string[]; removeAssignees?: readonly string[];
  addResourceIds?: readonly string[]; removeResourceIds?: readonly string[]; addNodeIds?: readonly string[]; removeNodeIds?: readonly string[];
  reason?: 'completed' | 'not_planned'; comment?: string;
}
export interface IssueService {
  listIssues(userId: string, query: ListIssuesQuery): Promise<IssueListView>;
  readIssue(userId: string, spaceId: string, number: number, options: { readonly timeline: boolean }): Promise<{ readonly view: IssueDetailView; readonly sets: IssueSets }>;
  createIssue(userId: string, spaceId: string, input: IssueChange & { readonly title: string }): Promise<IssueSummaryView>;
  updateIssue(userId: string, spaceId: string, number: number, change: IssueChange): Promise<IssueSummaryView>;
  commentOnIssue(userId: string, spaceId: string, number: number, body: string): Promise<{ readonly id: string }>;
  listIssueLabels(userId: string, spaceId: string): Promise<readonly { readonly id: string; readonly name: string }[]>;
  openDocument(userId: string, resourceId: string): Promise<{ readonly nodeId: string }>;
}
function invalid(message: string): IssueOperationError { return new IssueOperationError(message, 'INVALID_REQUEST'); }
function nonEmpty(values: readonly string[] | undefined, name: string): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (values.some((value) => value.trim() === '')) throw invalid(`univer_issue ${name} must not contain empty values.`);
  return values;
}
export async function runIssueOperation(args: IssueArguments, userId: string, spaceId: string, service: IssueService) {
  const wrap = async (result: Promise<unknown>) => {
    try {
      return { ok: true as const, operation: "issue" as const, result: (await result) as JsonValue };
    } catch (error) {
      // Workspace's generic 409 text says "changed concurrently", which would send the model
      // into a pointless retry when the Space simply is not a Team Space.
      if (error instanceof WorkspaceApiError && error.status === 409 && /team spaces/i.test(error.message)) {
        throw new IssueOperationError(
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
        throw new IssueOperationError(
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
}
