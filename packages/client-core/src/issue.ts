import { workspaceError } from "./errors.js";
import type { AuthenticatedWorkspaceHttp, WorkspaceHttp } from "./http.js";
import { isWorkspaceRecord } from "./http.js";
import {
  parseIssue,
  parseIssueComment,
  parseIssueLabel,
  parseIssuePage,
  parseTimelinePage,
  type WorkspaceIssue,
  type WorkspaceIssueLabel,
  type WorkspaceIssuePage,
  type WorkspaceIssueTimelineItem,
} from "./issue-model.js";

export interface WorkspaceIssueLabelUsage extends WorkspaceIssueLabel {
  readonly openIssueCount: number;
}

export interface ListIssuesInput {
  /** Omit to list across every Team Space the caller belongs to. */
  readonly spaceId?: string;
  readonly assignee?: string;
  readonly author?: string;
  readonly cursor?: string;
  readonly labels?: readonly string[];
  readonly limit?: number;
  readonly order?: "asc" | "desc";
  readonly search?: string;
  readonly sort?: "created" | "updated";
  readonly state?: "open" | "closed" | "all";
}

export interface UpdateIssueInput {
  readonly addAssignees?: readonly string[];
  readonly addLabels?: readonly string[];
  readonly addNodes?: readonly string[];
  readonly body?: string;
  readonly removeAssignees?: readonly string[];
  readonly removeLabels?: readonly string[];
  readonly removeNodes?: readonly string[];
  readonly state?: "open" | "closed";
  readonly stateReason?: "completed" | "not_planned";
  readonly title?: string;
}

/**
 * Issue writes are not idempotent: after `workspace-result-unknown`, list the Space or read the
 * timeline before retrying a create or comment.
 */
export class WorkspaceIssueFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async list(input: ListIssuesInput): Promise<WorkspaceIssuePage> {
    const query = new URLSearchParams();
    if (input.state !== undefined) query.set("state", input.state);
    for (const label of input.labels ?? []) query.append("label", label);
    if (input.assignee !== undefined) query.set("assignee", input.assignee);
    if (input.author !== undefined) query.set("author", input.author);
    if (input.search !== undefined) query.set("q", input.search);
    if (input.sort !== undefined) query.set("sort", input.sort);
    if (input.order !== undefined) query.set("order", input.order);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    if (input.cursor !== undefined) query.set("cursor", input.cursor);
    const base =
      input.spaceId === undefined ? "/api/issues" : `${spacePath(input.spaceId)}/issues`;
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return parseIssuePage(await (await this.authenticatedHttp()).json(`${base}${suffix}`));
  }

  public async get(spaceId: string, number: number): Promise<WorkspaceIssue> {
    return parseIssue(await (await this.authenticatedHttp()).json(issuePath(spaceId, number)));
  }

  /** Reads every page of the timeline. */
  public async timeline(
    spaceId: string,
    number: number,
  ): Promise<readonly WorkspaceIssueTimelineItem[]> {
    const http = await this.authenticatedHttp();
    const items: WorkspaceIssueTimelineItem[] = [];
    let cursor: string | null = null;
    do {
      const query: URLSearchParams = new URLSearchParams({ limit: "200" });
      if (cursor !== null) query.set("cursor", cursor);
      const page = parseTimelinePage(
        await http.json(`${issuePath(spaceId, number)}/timeline?${query.toString()}`),
      );
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
  }

  public async create(input: {
    readonly assignees?: readonly string[];
    readonly body?: string;
    readonly labels?: readonly string[];
    readonly nodeIds?: readonly string[];
    readonly spaceId: string;
    readonly title: string;
  }): Promise<WorkspaceIssue> {
    const http = await this.authenticatedHttp();
    const labelIds = input.labels && (await resolveLabelIds(http, input.spaceId, input.labels));
    const assigneeUserIds = input.assignees && (await resolveUsers(http, input.assignees));
    return parseIssue(
      await http.json(`${spacePath(input.spaceId)}/issues`, {
        body: {
          title: input.title,
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(labelIds ? { labelIds } : {}),
          ...(assigneeUserIds ? { assigneeUserIds } : {}),
          ...(input.nodeIds ? { nodeIds: [...input.nodeIds] } : {}),
        },
        method: "POST",
      }),
    );
  }

  /**
   * Set changes read the current Issue and send the whole resulting set, so two clients editing
   * the same set at once can lose one edit (the API is last-writer-wins).
   */
  public async update(
    spaceId: string,
    number: number,
    input: UpdateIssueInput,
  ): Promise<WorkspaceIssue> {
    const http = await this.authenticatedHttp();
    const changesLabels = hasEntries(input.addLabels) || hasEntries(input.removeLabels);
    const changesAssignees = hasEntries(input.addAssignees) || hasEntries(input.removeAssignees);
    const changesNodes = hasEntries(input.addNodes) || hasEntries(input.removeNodes);
    const current =
      changesLabels || changesAssignees || changesNodes
        ? parseIssue(await http.json(issuePath(spaceId, number)))
        : undefined;
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body["title"] = input.title;
    if (input.body !== undefined) body["body"] = input.body;
    if (input.state !== undefined) body["state"] = input.state;
    if (input.stateReason !== undefined) body["stateReason"] = input.stateReason;
    if (current && changesLabels) {
      const add = await resolveLabelIds(http, spaceId, input.addLabels ?? []);
      const remove = await resolveLabelIds(http, spaceId, input.removeLabels ?? []);
      body["labelIds"] = applySet(current.labels.map((label) => label.id), add, remove);
    }
    if (current && changesAssignees) {
      const add = await resolveUsers(http, input.addAssignees ?? []);
      const remove = await resolveUsers(http, input.removeAssignees ?? []);
      body["assigneeUserIds"] = applySet(current.assignees.map((user) => user.id), add, remove);
    }
    if (current && changesNodes) {
      body["nodeIds"] = applySet(
        current.references.map((reference) => reference.nodeId),
        input.addNodes ?? [],
        input.removeNodes ?? [],
      );
    }
    if (Object.keys(body).length === 0) {
      throw workspaceError("workspace-argument-invalid", "Issue update needs at least one change.");
    }
    return parseIssue(
      await http.json(issuePath(spaceId, number), { body, method: "PATCH" }),
    );
  }

  public async comment(
    spaceId: string,
    number: number,
    body: string,
  ): Promise<Extract<WorkspaceIssueTimelineItem, { type: "comment" }>> {
    return parseIssueComment(
      await (await this.authenticatedHttp()).json(`${issuePath(spaceId, number)}/comments`, {
        body: { body },
        method: "POST",
      }),
    );
  }

  /** A comment, when given, is posted first so it precedes the closing event on the timeline. */
  public async close(
    spaceId: string,
    number: number,
    options: { readonly comment?: string; readonly reason?: "completed" | "not_planned" } = {},
  ): Promise<WorkspaceIssue> {
    if (options.comment !== undefined) {
      // The comment goes first so it precedes the closing event on the timeline. Check the right
      // before posting it: a denied close must not leave a comment that claims one happened.
      const issue = await this.get(spaceId, number);
      if (!issue.capabilities.close) {
        throw workspaceError(
          "issue-close-forbidden",
          "The current user cannot close this Issue.",
          { number, spaceId },
        );
      }
      await this.comment(spaceId, number, options.comment);
    }
    return await this.update(spaceId, number, {
      state: "closed",
      stateReason: options.reason ?? "completed",
    });
  }

  public async reopen(spaceId: string, number: number): Promise<WorkspaceIssue> {
    return await this.update(spaceId, number, { state: "open" });
  }

  public async labels(spaceId: string): Promise<readonly WorkspaceIssueLabelUsage[]> {
    const body = await (await this.authenticatedHttp()).json(`${spacePath(spaceId)}/issue-labels`);
    return parseLabelUsages(body);
  }

  public async createLabel(
    spaceId: string,
    input: { readonly color: string; readonly description?: string; readonly name: string },
  ): Promise<WorkspaceIssueLabel> {
    return parseIssueLabel(
      await (await this.authenticatedHttp()).json(`${spacePath(spaceId)}/issue-labels`, {
        body: input,
        method: "POST",
      }),
    );
  }

  public async updateLabel(
    spaceId: string,
    name: string,
    input: { readonly color?: string; readonly description?: string; readonly name?: string },
  ): Promise<WorkspaceIssueLabel> {
    const http = await this.authenticatedHttp();
    const [id] = await resolveLabelIds(http, spaceId, [name]);
    return parseIssueLabel(
      await http.json(`/api/issue-labels/${encodeURIComponent(id!)}`, {
        body: input,
        method: "PATCH",
      }),
    );
  }

  public async deleteLabel(spaceId: string, name: string): Promise<{ readonly deleted: string }> {
    const http = await this.authenticatedHttp();
    const [id] = await resolveLabelIds(http, spaceId, [name]);
    await http.request(`/api/issue-labels/${encodeURIComponent(id!)}`, { method: "DELETE" });
    return { deleted: name };
  }
}

function spacePath(spaceId: string): string {
  const id = spaceId.trim();
  if (id === "") throw workspaceError("workspace-argument-invalid", "Space ID must not be empty.");
  return `/api/spaces/${encodeURIComponent(id)}`;
}

function issuePath(spaceId: string, number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw workspaceError("workspace-argument-invalid", "Issue number must be a positive integer.");
  }
  return `${spacePath(spaceId)}/issues/${String(number)}`;
}

function hasEntries(values: readonly string[] | undefined): boolean {
  return values !== undefined && values.length > 0;
}

function applySet(
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const drop = new Set(remove);
  return [...new Set([...current, ...add])].filter((id) => !drop.has(id));
}

async function labelsOf(http: WorkspaceHttp, spaceId: string) {
  return parseLabelUsages(await http.json(`${spacePath(spaceId)}/issue-labels`));
}

async function resolveLabelIds(
  http: WorkspaceHttp,
  spaceId: string,
  names: readonly string[],
): Promise<string[]> {
  if (names.length === 0) return [];
  const known = new Map((await labelsOf(http, spaceId)).map((label) => [label.name.toLowerCase(), label.id]));
  return names.map((name) => {
    const id = known.get(name.trim().toLowerCase());
    if (id === undefined) {
      throw workspaceError("issue-label-not-found", `Space has no Issue label named "${name}".`, {
        labels: [...known.keys()],
      });
    }
    return id;
  });
}

async function resolveUsers(http: WorkspaceHttp, users: readonly string[]): Promise<string[]> {
  if (!users.includes("me")) return [...users];
  const session = await http.json("/api/session");
  const user = session["user"];
  if (session["authenticated"] !== true || !isWorkspaceRecord(user) || typeof user["id"] !== "string") {
    throw workspaceError("workspace-authentication-required", "Workspace Session is missing or expired.");
  }
  const me = user["id"];
  return users.map((value) => (value === "me" ? me : value));
}

function parseLabelUsages(body: Record<string, unknown>): WorkspaceIssueLabelUsage[] {
  if (!Array.isArray(body["labels"])) {
    throw workspaceError("workspace-invalid-response", "Workspace response is missing Issue labels.");
  }
  return body["labels"].map((label) => {
    const count = isWorkspaceRecord(label) ? label["openIssueCount"] : undefined;
    if (typeof count !== "number") {
      throw workspaceError("workspace-invalid-response", "Workspace Issue label is malformed.");
    }
    return { ...parseIssueLabel(label), openIssueCount: count };
  });
}
