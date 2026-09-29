import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver, SpaceAccess } from "../access/index.js";
import type { PublicUser } from "../permissions/index.js";
import {
  IssuesRepository,
  type CommentRow,
  type IssueFilter,
  type IssueRow,
  type LabelRow,
} from "./issues.repository.js";
import {
  ISSUE_LABEL_COLORS,
  type IssueCommentView,
  type IssueEventKind,
  type IssueLabelView,
  type IssueList,
  type IssueListQuery,
  type IssueProductChange,
  type IssueReferenceView,
  type IssueState,
  type IssueStateReason,
  type IssueSummaryView,
  type IssueTimelineItem,
  type IssueView,
  type IssuesModule,
} from "./issues.types.js";

const MAX_TITLE = 256;
const MAX_TEXT = 65_536;
const MAX_LABELS_PER_SPACE = 100;
const MAX_LABELS_PER_ISSUE = 20;
const MAX_ASSIGNEES = 10;
const MAX_REFERENCES = 20;
const MAX_LABEL_NAME = 50;
const MAX_LABEL_DESCRIPTION = 200;
const MAX_SEARCH = 200;
const MAX_LABEL_FILTERS = 10;

interface Relations {
  readonly labelIds?: readonly string[];
  readonly assigneeUserIds?: readonly string[];
  readonly nodeIds?: readonly string[];
}

export function createIssuesModule(options: {
  readonly repository: IssuesRepository;
  readonly access: AccessResolver;
  readonly now?: () => number;
  readonly onChanged?: (change: IssueProductChange) => void;
}): IssuesModule {
  const { repository, access } = options;
  const now = options.now ?? Date.now;

  function notify(spaceId: string): void {
    try {
      options.onChanged?.({ spaceId, audienceUserIds: repository.audience(spaceId) });
    } catch {
      // Change delivery is a cache hint; a failed push must not fail the committed write.
    }
  }

  function requireSpace(userId: string, spaceId: string): SpaceAccess {
    const space = access.resolveSpace(userId, spaceId);
    if (!space) throw notFound();
    if (space.type !== "team") {
      throw new ApplicationError("CONFLICT", 409, "Issues are available only in team spaces.");
    }
    return space;
  }

  function requireIssue(spaceId: string, number: unknown): IssueRow {
    const row = repository.findIssue(spaceId, issueNumber(number));
    if (!row) throw notFound();
    return row;
  }

  function summaries(rows: readonly IssueRow[]): IssueSummaryView[] {
    const ids = rows.map((row) => row.id);
    const labels = repository.labelsFor(ids);
    const assignees = repository.assigneeIdsFor(ids);
    const comments = repository.commentCounts(ids);
    const references = repository.referenceCounts(ids);
    const users = repository.users([
      ...rows.flatMap((row) => [row.author_user_id, ...(row.closed_by_user_id ? [row.closed_by_user_id] : [])]),
      ...[...assignees.values()].flat().map((assignee) => assignee.user_id),
    ]);
    return rows.map((row) => ({
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
      commentCount: comments.get(row.id) ?? 0,
      referenceCount: references.get(row.id) ?? 0,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  function issueView(userId: string, space: SpaceAccess, row: IssueRow): IssueView {
    const [summary] = summaries([row]);
    if (!summary) throw new Error("Issue summary is missing");
    const editable = space.member && (row.author_user_id === userId || space.capabilities.triageIssues);
    return {
      ...summary,
      body: row.body,
      references: repository.referenceNodeIds(row.id).map((nodeId) => reference(userId, row.space_id, nodeId)),
      capabilities: {
        edit: editable,
        close: editable,
        triage: space.capabilities.triageIssues,
        comment: space.member,
      },
    };
  }

  function reference(userId: string, spaceId: string, nodeId: string): IssueReferenceView {
    const node = access.resolveNode(userId, nodeId);
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

  function listFor(
    userId: string,
    scope: IssueFilter["scope"],
    query: IssueListQuery,
  ): IssueList {
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
    };
    const limit = validLimit(query.limit, 50);
    const cursor = decodeCursor<{ ts: number; id: string }>(query.cursor, (value) =>
      Number.isSafeInteger(value.ts) && typeof value.id === "string" && value.id !== "");
    const rows = repository.listIssues(filter, { sort, order, cursor, limit: limit + 1 });
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const column = sort === "created" ? "created_at" : "updated_at";
    return {
      items: summaries(page),
      nextCursor: hasNext && last ? encodeCursor({ ts: last[column], id: last.id }) : null,
      counts: repository.countIssues(filter),
    };
  }

  /** Diff the requested relation sets against the stored ones and record one event per change. */
  function applyRelations(
    userId: string,
    space: SpaceAccess,
    issueId: string,
    desired: Relations,
    at: number,
  ): boolean {
    let changed = false;
    const event = (kind: IssueEventKind, payload: Record<string, unknown>) => {
      repository.insertEvent({ id: randomUUID(), issueId, actorUserId: userId, kind, payload, now: at });
      changed = true;
    };
    const current = repository.labelsFor([issueId]).get(issueId) ?? [];
    if (desired.labelIds) {
      const wanted = new Set(desired.labelIds);
      if (wanted.size > MAX_LABELS_PER_ISSUE) throw invalid(`An Issue can have at most ${MAX_LABELS_PER_ISSUE} labels.`, "labelIds");
      for (const label of current) {
        if (wanted.has(label.id)) continue;
        repository.removeLabel(issueId, label.id);
        event("unlabeled", { labelId: label.id, name: label.name, color: label.color });
      }
      const have = new Set(current.map((label) => label.id));
      for (const labelId of wanted) {
        if (have.has(labelId)) continue;
        const label = repository.findLabel(labelId);
        if (!label || label.space_id !== space.id) throw invalid("Label does not belong to this Space.", "labelIds");
        repository.addLabel(issueId, labelId);
        event("labeled", { labelId, name: label.name, color: label.color });
      }
    }
    if (desired.assigneeUserIds) {
      const wanted = new Set(desired.assigneeUserIds);
      if (wanted.size > MAX_ASSIGNEES) throw invalid(`An Issue can have at most ${MAX_ASSIGNEES} assignees.`, "assigneeUserIds");
      const have = repository.assigneeIdsFor([issueId]).get(issueId)?.map((row) => row.user_id) ?? [];
      const users = repository.users([...wanted, ...have]);
      for (const assigneeId of have) {
        if (wanted.has(assigneeId)) continue;
        repository.removeAssignee(issueId, assigneeId);
        event("unassigned", userSnapshot(users.get(assigneeId), assigneeId));
      }
      for (const assigneeId of wanted) {
        if (have.includes(assigneeId)) continue;
        if (!repository.isSpaceParticipant(space.id, assigneeId)) {
          throw invalid("Assignees must be the owner or a member of this Space.", "assigneeUserIds");
        }
        repository.addAssignee(issueId, assigneeId);
        event("assigned", userSnapshot(users.get(assigneeId), assigneeId));
      }
    }
    if (desired.nodeIds) {
      const wanted = new Set(desired.nodeIds);
      if (wanted.size > MAX_REFERENCES) throw invalid(`An Issue can reference at most ${MAX_REFERENCES} files.`, "nodeIds");
      const have = repository.referenceNodeIds(issueId);
      for (const nodeId of have) {
        if (wanted.has(nodeId)) continue;
        repository.removeReference(issueId, nodeId);
        event("node_unreferenced", { nodeId, name: access.resolveNode(userId, nodeId)?.name ?? null });
      }
      for (const nodeId of wanted) {
        if (have.includes(nodeId)) continue;
        const node = access.resolveNode(userId, nodeId);
        if (!node || node.spaceId !== space.id) throw invalid("Referenced files must be in this Space.", "nodeIds");
        repository.addReference(issueId, nodeId, at);
        event("node_referenced", { nodeId, name: node.name });
      }
    }
    return changed;
  }

  return {
    list(userId, spaceId, query) {
      requireSpace(userId, spaceId);
      return listFor(userId, { kind: "space", spaceId }, query);
    },

    listMine(userId, query) {
      return listFor(userId, { kind: "member", userId }, query);
    },

    create(userId, spaceId, input) {
      const space = requireSpace(userId, spaceId);
      if (!space.capabilities.createIssue) throw forbidden();
      const body = record(input, ["title", "body", "labelIds", "assigneeUserIds", "nodeIds"]);
      const relations = parseRelations(body);
      const hasRelations = Object.values(relations).some((value) => value !== undefined && value.length > 0);
      if (hasRelations && !space.capabilities.triageIssues) throw forbidden();
      const title = validTitle(body.title);
      const text = body.body === undefined ? "" : validText(body.body, "body", true);
      const id = randomUUID();
      const at = now();
      repository.transaction(() => {
        repository.insertIssue({
          id, spaceId, number: repository.nextNumber(spaceId), title, body: text, authorUserId: userId, now: at,
        });
        applyRelations(userId, space, id, relations, at);
      });
      notify(spaceId);
      return issueView(userId, space, mustFind(repository, id));
    },

    get(userId, spaceId, number) {
      const space = requireSpace(userId, spaceId);
      return issueView(userId, space, requireIssue(spaceId, number));
    },

    update(userId, spaceId, number, input) {
      const space = requireSpace(userId, spaceId);
      if (!space.member) throw forbidden();
      const patch = parseUpdate(input);
      const at = now();
      const id = repository.transaction(() => {
        const row = requireIssue(spaceId, number);
        const triage = space.capabilities.triageIssues;
        const editable = row.author_user_id === userId || triage;
        const touchesText = patch.title !== undefined || patch.body !== undefined || patch.state !== undefined;
        const touchesRelations = patch.labelIds !== undefined || patch.assigneeUserIds !== undefined || patch.nodeIds !== undefined;
        if ((touchesText && !editable) || (touchesRelations && !triage)) throw forbidden();
        let changed = false;
        const title = patch.title ?? row.title;
        const text = patch.body ?? row.body;
        if (title !== row.title || text !== row.body) {
          repository.updateIssueText(row.id, title, text, at);
          changed = true;
          if (title !== row.title) {
            repository.insertEvent({
              id: randomUUID(), issueId: row.id, actorUserId: userId, kind: "renamed",
              payload: { from: row.title, to: title }, now: at,
            });
          }
        }
        if (patch.state === "closed" && (row.state !== "closed" || row.state_reason !== patch.stateReason)) {
          repository.setIssueState(row.id, "closed", patch.stateReason, userId, at);
          repository.insertEvent({
            id: randomUUID(), issueId: row.id, actorUserId: userId, kind: "closed",
            payload: { reason: patch.stateReason }, now: at,
          });
          changed = true;
        } else if (patch.state === "open" && row.state === "closed") {
          repository.setIssueState(row.id, "open", null, null, at);
          repository.insertEvent({
            id: randomUUID(), issueId: row.id, actorUserId: userId, kind: "reopened", payload: {}, now: at,
          });
          changed = true;
        }
        if (applyRelations(userId, space, row.id, patch, at)) changed = true;
        if (changed) repository.touch(row.id, at);
        return row.id;
      });
      notify(spaceId);
      return issueView(userId, space, mustFind(repository, id));
    },

    timeline(userId, spaceId, number, page) {
      requireSpace(userId, spaceId);
      const issue = requireIssue(spaceId, number);
      const limit = validLimit(page.limit, 100);
      const cursor = decodeCursor<{ ts: number; rank: number; id: string }>(page.cursor, (value) =>
        Number.isSafeInteger(value.ts) && (value.rank === 0 || value.rank === 1) && typeof value.id === "string" && value.id !== "");
      const rows = repository.timeline(issue.id, cursor, limit + 1);
      const hasNext = rows.length > limit;
      const visible = hasNext ? rows.slice(0, limit) : rows;
      const users = repository.users(visible.map((row) => row.actor_user_id));
      const items = visible.map((row): IssueTimelineItem =>
        row.type === "comment"
          ? {
              type: "comment", id: row.id, author: user(users, row.actor_user_id), body: row.body ?? "",
              createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
            }
          : {
              type: "event", id: row.id, kind: row.kind as IssueEventKind, actor: user(users, row.actor_user_id),
              payload: JSON.parse(row.payload_json ?? "{}") as Record<string, unknown>, createdAt: iso(row.created_at),
            });
      const last = visible.at(-1);
      return {
        items,
        nextCursor: hasNext && last
          ? encodeCursor({ ts: last.created_at, rank: last.type === "comment" ? 0 : 1, id: last.id })
          : null,
      };
    },

    createComment(userId, spaceId, number, input) {
      const space = requireSpace(userId, spaceId);
      if (!space.member) throw forbidden();
      const body = validText(record(input, ["body"]).body, "body", false);
      const issue = requireIssue(spaceId, number);
      const id = randomUUID();
      const at = now();
      repository.transaction(() => {
        repository.insertComment({ id, issueId: issue.id, authorUserId: userId, body, now: at });
        repository.touch(issue.id, at);
      });
      notify(spaceId);
      return commentView(repository, id);
    },

    updateComment(userId, commentId, input) {
      const { comment, space } = requireComment(userId, commentId);
      if (!space.member || comment.author_user_id !== userId) throw forbidden();
      const body = validText(record(input, ["body"]).body, "body", false);
      const at = now();
      repository.transaction(() => {
        repository.updateComment(commentId, body, at);
        repository.touch(comment.issue_id, at);
      });
      notify(comment.space_id);
      return commentView(repository, commentId);
    },

    deleteComment(userId, commentId) {
      const { comment, space } = requireComment(userId, commentId);
      const manager = space.role === "owner" || space.role === "admin";
      if (!space.member || (comment.author_user_id !== userId && !manager)) throw forbidden();
      repository.transaction(() => {
        repository.deleteComment(commentId);
        repository.touch(comment.issue_id, now());
      });
      notify(comment.space_id);
    },

    listLabels(userId, spaceId) {
      requireSpace(userId, spaceId);
      return {
        labels: repository.listLabels(spaceId).map((row) => ({ ...labelView(row), openIssueCount: row.open_issue_count })),
      };
    },

    createLabel(userId, spaceId, input) {
      const space = requireSpace(userId, spaceId);
      if (!space.capabilities.manageIssueLabels) throw forbidden();
      const fields = parseLabel(input, null);
      const id = randomUUID();
      repository.transaction(() => {
        if (repository.countLabels(spaceId) >= MAX_LABELS_PER_SPACE) {
          throw invalid(`A Space can have at most ${MAX_LABELS_PER_SPACE} labels.`, "name");
        }
        if (repository.findLabelByName(spaceId, fields.name)) throw labelNameTaken();
        repository.insertLabel({ id, space_id: spaceId, ...fields, now: now() });
      });
      notify(spaceId);
      return labelView({ id, ...fields });
    },

    updateLabel(userId, labelId, input) {
      const { label } = requireLabel(userId, labelId);
      const fields = parseLabel(input, label);
      repository.transaction(() => {
        const clash = repository.findLabelByName(label.space_id, fields.name);
        if (clash && clash.id !== labelId) throw labelNameTaken();
        repository.updateLabel({ id: labelId, ...fields, now: now() });
      });
      notify(label.space_id);
      return labelView({ ...label, ...fields });
    },

    deleteLabel(userId, labelId) {
      const { label } = requireLabel(userId, labelId);
      repository.deleteLabel(labelId);
      notify(label.space_id);
    },
  };

  function requireComment(userId: string, commentId: string): { comment: CommentRow; space: SpaceAccess } {
    const comment = repository.findComment(commentId);
    if (!comment) throw notFound();
    return { comment, space: requireSpace(userId, comment.space_id) };
  }

  function requireLabel(userId: string, labelId: string): { label: LabelRow; space: SpaceAccess } {
    const label = repository.findLabel(labelId);
    if (!label) throw notFound();
    const space = requireSpace(userId, label.space_id);
    if (!space.capabilities.manageIssueLabels) throw forbidden();
    return { label, space };
  }
}

function mustFind(repository: IssuesRepository, id: string): IssueRow {
  const row = repository.findIssueById(id);
  if (!row) throw new Error("Issue is missing after write");
  return row;
}

function commentView(repository: IssuesRepository, id: string): IssueCommentView {
  const comment = repository.findComment(id);
  if (!comment) throw new Error("Issue comment is missing after write");
  return {
    id: comment.id,
    author: user(repository.users([comment.author_user_id]), comment.author_user_id),
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

function userSnapshot(found: PublicUser | undefined, userId: string): Record<string, unknown> {
  return { userId, username: found?.username ?? null, displayName: found?.displayName ?? null };
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

function parseRelations(body: Record<string, unknown>): Relations {
  const labelIds = stringList(body.labelIds, "labelIds");
  const assigneeUserIds = stringList(body.assigneeUserIds, "assigneeUserIds");
  const nodeIds = stringList(body.nodeIds, "nodeIds");
  return {
    ...(labelIds ? { labelIds } : {}),
    ...(assigneeUserIds ? { assigneeUserIds } : {}),
    ...(nodeIds ? { nodeIds } : {}),
  };
}

function parseUpdate(input: unknown): Relations & {
  readonly title?: string;
  readonly body?: string;
  readonly state?: IssueState;
  readonly stateReason: IssueStateReason | null;
} {
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

function parseLabel(
  input: unknown,
  existing: LabelRow | null,
): { name: string; color: string; description: string } {
  const body = record(input, ["name", "color", "description"]);
  if (existing && Object.keys(body).length === 0) throw invalid("At least one label field is required.");
  const name = body.name === undefined && existing ? existing.name : typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_LABEL_NAME) {
    throw invalid(`name must contain between 1 and ${MAX_LABEL_NAME} characters.`, "name");
  }
  const color = body.color === undefined && existing ? existing.color : body.color;
  if (typeof color !== "string" || !(ISSUE_LABEL_COLORS as readonly string[]).includes(color)) {
    throw invalid(`color must be one of ${ISSUE_LABEL_COLORS.join(", ")}.`, "color");
  }
  const description = body.description === undefined ? (existing?.description ?? "") : body.description;
  if (typeof description !== "string" || description.length > MAX_LABEL_DESCRIPTION) {
    throw invalid(`description must not exceed ${MAX_LABEL_DESCRIPTION} characters.`, "description");
  }
  return { name, color, description };
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

function invalid(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}

function forbidden(): ApplicationError {
  return new ApplicationError("FORBIDDEN", 403, "The current user cannot perform this Issue action.");
}

function labelNameTaken(): ApplicationError {
  return new ApplicationError("CONFLICT", 409, "A label with this name already exists.");
}
