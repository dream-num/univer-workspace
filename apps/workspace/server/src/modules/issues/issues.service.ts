import { forbidden, invalid, notFound } from "./issues.errors.js";
import { randomUUID } from "node:crypto";
import { checkCommentWrite, checkCreateRelations, mayClose, requireIssueSpace } from "./issue-changes.js";
import { writeSourceView } from "../identity/index.js";
import { logger } from "../../logging/logger.js";
import type { AccessResolver, NodeAccess, SpaceAccess } from "../access/index.js";
import type { AccessChanges, PublicUser } from "../permissions/index.js";
import type {
  IssuesRepository,
  IssueDetail,
  IssueSummaryData,
  LabelFields,
  CommentRow,
  IssueFilter,
  VerdictRow,
  IssueRelations,
  IssueUpdate,
  IssueRow,
  LabelRow,
} from "./issues.repository.js";
import {
  ISSUE_LABEL_COLORS,
  ISSUE_VERDICT_KINDS,
  type IssueAcceptanceView,
  type IssueCommentView,
  type IssueEventKind,
  type IssueLabelView,
  type IssueList,
  type IssueListQuery,
  type IssueProductChange,
  type IssueReferenceView,
  type IssueStateReason,
  type IssueSummaryView,
  type IssueTimelineItem,
  type IssuePullRequestView,
  type IssueVerdictKind,
  type RequestedVerdictKind,
  type IssueView,
  type IssuesModule,
} from "./issues.types.js";

const MAX_TITLE = 256;
const MAX_TEXT = 65_536;
const MAX_ACTIVITY_ROWS = 1000;
const MAX_LABEL_NAME = 50;
const MAX_LABEL_DESCRIPTION = 200;
const MAX_SEARCH = 200;
const MAX_LABEL_FILTERS = 10;
/** A deadline pass tries at most this many Issues per Issue it may accept. */
const DUE_ATTEMPTS_PER_ACCEPT = 4;
const TIMELINE_RANKS = { comment: 0, event: 1, verdict: 2 } as const;

export function createIssuesModule(options: {
  readonly repository: IssuesRepository;
  readonly access: AccessResolver;
  readonly now?: () => number;
  readonly onChanged?: (change: IssueProductChange) => void;
  readonly pullRequests?: (userId: string, issueId: string) => Promise<readonly IssuePullRequestView[]>;
  readonly accessChanges: (
    userId: string,
    spaceId: string,
    actors: readonly { readonly userId: string; readonly since: number }[],
    readerMayAccept: boolean,
  ) => Promise<AccessChanges>;
}): IssuesModule {
  const { repository, access } = options;
  const now = options.now ?? Date.now;

  async function notify(spaceId: string): Promise<void> {
    try {
      options.onChanged?.({ spaceId, audienceUserIds: await repository.audience(spaceId) });
    } catch {
      // Change delivery is a cache hint; a failed push must not fail the committed write.
    }
  }

  async function requireSpace(userId: string, spaceId: string): Promise<SpaceAccess> {
    return requireIssueSpace(await access.resolveSpace(userId, spaceId));
  }

  async function requireIssue(spaceId: string, number: unknown): Promise<IssueRow> {
    const row = await repository.findIssue(spaceId, issueNumber(number));
    if (!row) throw notFound();
    return row;
  }

  function summaryView(row: IssueRow, data: IssueSummaryData): IssueSummaryView {
    const { labels, assignees, commentCounts, referenceCounts, users } = data;
    return {
      id: row.id,
      number: row.number,
      space: { id: row.space_id, name: row.space_name },
      title: row.title,
      state: row.state,
      stateReason: row.state_reason,
      author: user(users, row.author_user_id),
      closedBy: row.closed_by_user_id ? user(users, row.closed_by_user_id) : null,
      closedAt: row.closed_at === null ? null : iso(row.closed_at),
      labels: (labels.get(row.id) ?? []).map(labelView),
      assignees: (assignees.get(row.id) ?? []).map((assignee) => user(users, assignee.user_id)),
      commentCount: commentCounts.get(row.id) ?? 0,
      referenceCount: referenceCounts.get(row.id) ?? 0,
      createdVia: writeSourceView(row.created_via),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async function acceptanceView(verdict: VerdictRow | null, acceptAt: number | null): Promise<IssueAcceptanceView | null> {
    if (!verdict) return null;
    const actor = verdict.actor_user_id;
    return {
      kind: verdict.kind,
      actor: actor === null ? null : user(await repository.users([actor]), actor),
      body: verdict.body,
      createdAt: iso(verdict.created_at),
      deadline: acceptAt === null ? null : iso(acceptAt),
    };
  }

  async function issueView(userId: string, { row, space, summary, references, acceptance, acceptAt }: IssueDetail): Promise<IssueView> {
    const editable = mayClose(space, row, userId);
    return {
      ...summaryView(row, summary),
      body: row.body,
      references: references.map(({ nodeId, node }) => reference(row.space_id, nodeId, node)),
      capabilities: {
        edit: editable,
        close: editable,
        triage: space.capabilities.triageIssues,
        comment: space.member,
      },
      pullRequests: await options.pullRequests?.(userId, row.id) ?? [],
      acceptance: await acceptanceView(acceptance, acceptAt),
    };
  }

  function reference(spaceId: string, nodeId: string, node: NodeAccess | null): IssueReferenceView {
    if (!node || node.spaceId !== spaceId) return { nodeId, available: false, name: null, resource: null };
    return {
      nodeId,
      available: true,
      name: node.name,
      resource:
        node.resourceId && node.resourceKind === "univer" && node.unitId && node.unitType
          ? { id: node.resourceId, kind: "univer", unitId: node.unitId, unitType: node.unitType }
          : node.resourceId && node.resourceKind === "blob" && node.blobMediaType
            ? { id: node.resourceId, kind: "blob", mediaType: node.blobMediaType }
            : null,
    };
  }

  async function listFor(
    userId: string,
    scope: IssueFilter["scope"],
    query: IssueListQuery,
  ): Promise<IssueList> {
    const state = parseEnum(query.state, ["open", "closed", "all"], "open", "state");
    const sort = parseEnum(query.sort, ["created", "updated"], "created", "sort");
    const order = parseEnum(query.order, ["asc", "desc"], "desc", "order");
    const filter: IssueFilter = {
      scope,
      state,
      labelNames: labelFilters(query.label),
      assignee: query.assignee === undefined ? null : query.assignee === "none" ? "none" : { userId: userFilter(query.assignee, userId, "assignee") },
      authorUserId: query.author === undefined ? null : userFilter(query.author, userId, "author"),
      search: searchFilter(query.q),
      acceptance: query.acceptance === undefined ? null : parseEnum(query.acceptance, ["submitted", "sent_back"] as const, "submitted", "acceptance"),
    };
    const limit = validLimit(query.limit, 50);
    const cursor = decodeCursor<{ ts: number; id: string }>(query.cursor, (value) =>
      Number.isSafeInteger(value.ts) && typeof value.id === "string" && value.id !== "");
    const rows = await repository.listIssues(filter, { sort, order, cursor, limit: limit + 1 });
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const column = sort === "created" ? "created_at" : "updated_at";
    const summary = await repository.summaryData(page);
    return {
      items: page.map((row) => summaryView(row, summary)),
      nextCursor: hasNext && last ? encodeCursor({ ts: last[column], id: last.id }) : null,
      counts: await repository.countIssues(filter),
    };
  }

  return {
    async activity(userId, spaceId, since) {
      await requireSpace(userId, spaceId);
      const rows = await repository.activityRows(spaceId, since, MAX_ACTIVITY_ROWS + 1);
      const page = rows.slice(0, MAX_ACTIVITY_ROWS);
      const users = await repository.users(page.flatMap((row) => [
        row.author_user_id, ...(row.closed_by_user_id ? [row.closed_by_user_id] : []),
      ]));
      return {
        items: page.map((row) => ({
          number: row.number, title: row.title, author: user(users, row.author_user_id),
          createdVia: row.created_via, createdAt: row.created_at,
          closedBy: row.closed_by_user_id ? user(users, row.closed_by_user_id) : null,
          closedAt: row.closed_at,
        })),
        complete: rows.length <= MAX_ACTIVITY_ROWS,
      };
    },

    async list(userId, spaceId, query) {
      await requireSpace(userId, spaceId);
      return listFor(userId, { kind: "space", spaceId }, query);
    },

    listMine(userId, query) {
      return listFor(userId, { kind: "member", userId }, query);
    },

    async create(userId, spaceId, input, createdVia = null) {
      const space = await requireSpace(userId, spaceId);
      if (!space.capabilities.createIssue) throw forbidden();
      const body = record(input, ["title", "body", "labelIds", "assigneeUserIds", "nodeIds"]);
      const relations = parseRelations(body);
      checkCreateRelations(space, relations);
      const title = validTitle(body.title);
      const text = body.body === undefined ? "" : validText(body.body, "body", true);
      const id = randomUUID();
      const at = now();
      const detail = await repository.createIssue({ id, spaceId, userId, createdVia, title, body: text, relations, now: at });
      await notify(spaceId);
      return issueView(userId, detail);
    },

    async get(userId, spaceId, number) {
      await requireSpace(userId, spaceId);
      return issueView(userId, await repository.issueDetail(userId, spaceId, issueNumber(number)));
    },

    async update(userId, spaceId, number, input) {
      const space = await requireSpace(userId, spaceId);
      if (!space.member) throw forbidden();
      const patch = parseUpdate(input);
      const at = now();
      const detail = await repository.updateIssue(userId, spaceId, issueNumber(number), patch, at);
      await notify(spaceId);
      return issueView(userId, detail);
    },

    async timeline(userId, spaceId, number, page) {
      await requireSpace(userId, spaceId);
      const issue = await requireIssue(spaceId, number);
      const limit = validLimit(page.limit, 100);
      const cursor = decodeCursor<{ ts: number; rank: number; id: string }>(page.cursor, (value) =>
        Number.isSafeInteger(value.ts) && [0, 1, 2].includes(value.rank) && typeof value.id === "string" && value.id !== "");
      const rows = await repository.timeline(issue.id, cursor, limit + 1);
      const hasNext = rows.length > limit;
      const visible = hasNext ? rows.slice(0, limit) : rows;
      const users = await repository.users(visible.flatMap((row) => row.actor_user_id === null ? [] : [row.actor_user_id]));
      const items = visible.map((row): IssueTimelineItem =>
        row.type === "comment"
          ? {
              type: "comment", id: row.id, author: user(users, row.actor_user_id!), body: row.body ?? "",
              createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
            }
          : {
              type: "event", id: row.id, kind: row.kind as IssueEventKind | IssueVerdictKind,
              actor: row.actor_user_id === null ? null : user(users, row.actor_user_id),
              payload: row.type === "verdict" ? { body: row.body ?? "" } : JSON.parse(row.payload_json ?? "{}") as Record<string, unknown>,
              createdAt: iso(row.created_at),
            });
      const last = visible.at(-1);
      return {
        items,
        nextCursor: hasNext && last
          ? encodeCursor({ ts: last.created_at, rank: TIMELINE_RANKS[last.type], id: last.id })
          : null,
      };
    },

    async createComment(userId, spaceId, number, input) {
      const space = await requireSpace(userId, spaceId);
      if (!space.member) throw forbidden();
      const body = validText(record(input, ["body"]).body, "body", false);
      const issue = await requireIssue(spaceId, number);
      const id = randomUUID();
      const at = now();
      const comment = await repository.insertComment({ id, issueId: issue.id, authorUserId: userId, body, now: at });
      await notify(spaceId);
      return commentView(repository, comment);
    },

    async verdict(userId, spaceId, number, input) {
      const fields = record(input, ["kind", "body"]);
      if (!(ISSUE_VERDICT_KINDS as readonly unknown[]).includes(fields.kind)) {
        throw invalid(`kind must be one of ${ISSUE_VERDICT_KINDS.join(", ")}.`, "kind");
      }
      const kind = fields.kind as RequestedVerdictKind;
      const body = validText(fields.body ?? "", "body", kind === "accepted");
      const detail = await repository.recordVerdict({
        id: randomUUID(), userId, spaceId, number: issueNumber(number), kind, body, now: now(),
      });
      await notify(spaceId);
      return issueView(userId, detail);
    },

    async recordReverted(userId, spaceId, number, operationId) {
      await repository.recordReverted({ id: randomUUID(), userId, spaceId, number, operationId, now: now() });
      await notify(spaceId);
    },

    async accessChanges(userId, spaceId, number) {
      const space = await requireSpace(userId, spaceId);
      const issue = await requireIssue(spaceId, number);
      const assignments = await repository.assignments(issue.id);
      const actors = assignments.map((row) => ({ userId: row.user_id, since: row.assigned_at }));
      return options.accessChanges(userId, spaceId, actors, mayClose(space, issue, userId));
    },

    async acceptDue(time, limit) {
      const spaceIds = new Set<string>();
      let accepted = 0;
      // A failed Issue is passed over, not counted. The sample is random, so Issues that keep failing cannot fill every pass.
      for (const issue of await repository.listDueIssues(time, limit * DUE_ATTEMPTS_PER_ACCEPT)) {
        if (accepted === limit) break;
        try {
          const spaceId = await repository.acceptDueIssue(issue.id, time);
          if (spaceId) {
            accepted++;
            spaceIds.add(spaceId);
          }
        } catch (error) {
          logger.error({ err: error, issueId: issue.id }, "Issue was not accepted by deadline");
        }
      }
      for (const spaceId of spaceIds) await notify(spaceId);
      return accepted;
    },

    async updateComment(userId, commentId, input) {
      const { comment, space } = await requireComment(userId, commentId);
      checkCommentWrite(space, userId, comment.author_user_id, "update");
      const body = validText(record(input, ["body"]).body, "body", false);
      const at = now();
      const updated = await repository.updateComment(userId, commentId, body, at);
      await notify(comment.space_id);
      return commentView(repository, updated);
    },

    async deleteComment(userId, commentId) {
      const spaceId = await repository.deleteComment(userId, commentId, now());
      await notify(spaceId);
    },

    async listLabels(userId, spaceId) {
      await requireSpace(userId, spaceId);
      return {
        labels: (await repository.listLabels(spaceId)).map((row) => ({ ...labelView(row), openIssueCount: row.open_issue_count })),
      };
    },

    async createLabel(userId, spaceId, input) {
      const space = await requireSpace(userId, spaceId);
      if (!space.capabilities.manageIssueLabels) throw forbidden();
      const fields = parseLabel(input, "create");
      const id = randomUUID();
      await repository.insertLabel(userId, { id, space_id: spaceId, ...fields, now: now() });
      await notify(spaceId);
      return labelView({ id, ...fields });
    },

    async updateLabel(userId, labelId, input) {
      await requireLabel(userId, labelId);
      const label = await repository.updateLabel(userId, labelId, parseLabel(input, "patch"), now());
      await notify(label.space_id);
      return labelView(label);
    },

    async deleteLabel(userId, labelId) {
      const spaceId = await repository.deleteLabel(userId, labelId);
      await notify(spaceId);
    },
  };

  async function requireComment(userId: string, commentId: string): Promise<{ comment: CommentRow; space: SpaceAccess }> {
    const comment = await repository.findComment(commentId);
    if (!comment) throw notFound();
    return { comment, space: await requireSpace(userId, comment.space_id) };
  }

  async function requireLabel(userId: string, labelId: string): Promise<void> {
    const label = await repository.findLabel(labelId);
    if (!label) throw notFound();
    const space = await requireSpace(userId, label.space_id);
    if (!space.capabilities.manageIssueLabels) throw forbidden();
  }
}

async function commentView(repository: IssuesRepository, comment: CommentRow): Promise<IssueCommentView> {
  return {
    id: comment.id,
    author: user(await repository.users([comment.author_user_id]), comment.author_user_id),
    body: comment.body,
    createdAt: iso(comment.created_at),
    updatedAt: iso(comment.updated_at),
  };
}

function labelView(row: Pick<LabelRow, "id" | "name" | "color" | "description">): IssueLabelView {
  return { id: row.id, name: row.name, color: row.color, description: row.description };
}

function user(users: ReadonlyMap<string, PublicUser>, id: string): PublicUser {
  const found = users.get(id);
  if (!found) throw new Error(`Issue user ${id} is missing`);
  return found;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("A JSON object is required.");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field ${key}.`, key);
  }
  return value as Record<string, unknown>;
}

function issueNumber(value: unknown): number {
  const number = typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
    throw invalid("number must be a positive integer.", "number");
  }
  return number;
}

function validTitle(value: unknown): string {
  if (typeof value !== "string") throw invalid("title is required.", "title");
  const title = value.trim();
  if (!title || title.length > MAX_TITLE) {
    throw invalid(`title must contain between 1 and ${MAX_TITLE} characters.`, "title");
  }
  return title;
}

function validText(value: unknown, field: string, allowEmpty: boolean): string {
  if (typeof value !== "string") throw invalid(`${field} must be a string.`, field);
  if (value.length > MAX_TEXT) throw invalid(`${field} must not exceed ${MAX_TEXT} characters.`, field);
  if (!allowEmpty && !value.trim()) throw invalid(`${field} must not be empty.`, field);
  return value;
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    throw invalid(`${field} must be an array of non-empty strings.`, field);
  }
  return [...new Set(value as string[])];
}

function parseRelations(body: Record<string, unknown>): IssueRelations {
  const labelIds = stringList(body.labelIds, "labelIds");
  const assigneeUserIds = stringList(body.assigneeUserIds, "assigneeUserIds");
  const nodeIds = stringList(body.nodeIds, "nodeIds");
  return {
    ...(labelIds ? { labelIds } : {}),
    ...(assigneeUserIds ? { assigneeUserIds } : {}),
    ...(nodeIds ? { nodeIds } : {}),
  };
}

function parseUpdate(input: unknown): IssueUpdate {
  const body = record(input, ["title", "body", "state", "stateReason", "labelIds", "assigneeUserIds", "nodeIds"]);
  if (Object.keys(body).length === 0) throw invalid("At least one Issue field is required.");
  const state = body.state === undefined ? undefined : parseEnum(body.state, ["open", "closed"], "open", "state");
  if (body.stateReason !== undefined && state !== "closed") {
    throw invalid("stateReason is only valid when closing an Issue.", "stateReason");
  }
  return {
    ...parseRelations(body),
    ...(body.title === undefined ? {} : { title: validTitle(body.title) }),
    ...(body.body === undefined ? {} : { body: validText(body.body, "body", true) }),
    ...(state === undefined ? {} : { state }),
    stateReason: state === "closed" ? parseEnum<IssueStateReason>(body.stateReason, ["completed", "not_planned"], "completed", "stateReason") : null,
  };
}

function parseLabel(input: unknown, mode: "create"): LabelFields;
function parseLabel(input: unknown, mode: "patch"): Partial<LabelFields>;
function parseLabel(input: unknown, mode: "create" | "patch"): Partial<LabelFields> {
  const body = record(input, ["name", "color", "description"]);
  if (mode === "patch" && Object.keys(body).length === 0) throw invalid("At least one label field is required.");
  const fields: { name?: string; color?: string; description?: string } = {};
  if (mode === "create" || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_LABEL_NAME) {
      throw invalid(`name must contain between 1 and ${MAX_LABEL_NAME} characters.`, "name");
    }
    fields.name = name;
  }
  if (mode === "create" || body.color !== undefined) {
    if (typeof body.color !== "string" || !(ISSUE_LABEL_COLORS as readonly string[]).includes(body.color)) {
      throw invalid(`color must be one of ${ISSUE_LABEL_COLORS.join(", ")}.`, "color");
    }
    fields.color = body.color;
  }
  if (mode === "create" || body.description !== undefined) {
    const description = body.description === undefined ? "" : body.description;
    if (typeof description !== "string" || description.length > MAX_LABEL_DESCRIPTION) {
      throw invalid(`description must not exceed ${MAX_LABEL_DESCRIPTION} characters.`, "description");
    }
    fields.description = description;
  }
  return fields;
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T, field: string): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw invalid(`${field} must be one of ${allowed.join(", ")}.`, field);
  }
  return value as T;
}

function labelFilters(value: unknown): string[] {
  if (value === undefined) return [];
  const names = Array.isArray(value) ? value : [value];
  if (names.length > MAX_LABEL_FILTERS || names.some((name) => typeof name !== "string" || !name || name.length > MAX_LABEL_NAME)) {
    throw invalid("label must be a label name.", "label");
  }
  return names as string[];
}

function userFilter(value: unknown, userId: string, field: string): string {
  if (typeof value !== "string" || !value) throw invalid(`${field} must be a user ID or "me".`, field);
  return value === "me" ? userId : value;
}

function searchFilter(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_SEARCH) throw invalid(`q must not exceed ${MAX_SEARCH} characters.`, "q");
  return value.trim() || null;
}

function validLimit(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw invalid("limit must be an integer between 1 and 200.", "limit");
  }
  return limit;
}

function decodeCursor<T extends object>(value: unknown, valid: (cursor: T) => boolean): T | null {
  if (value === undefined) return null;
  try {
    if (typeof value !== "string" || !value) throw new Error("invalid cursor");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
    if (typeof parsed !== "object" || parsed === null || !valid(parsed)) throw new Error("invalid cursor");
    return parsed;
  } catch {
    throw invalid("cursor is invalid.", "cursor");
  }
}

function encodeCursor(cursor: object): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
