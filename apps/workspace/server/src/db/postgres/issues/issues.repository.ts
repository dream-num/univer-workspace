import { randomUUID } from "node:crypto";
import type { SpaceAccess } from "../../../modules/access/index.js";
import type { PostgresAccessRepository } from "../access/access.repository.js";
import { assigneeEvent, checkCommentWrite, checkCreateRelations, checkLabelCapacity, requireIssueSpace, labelEvent, planIssueUpdate, referenceEvent, relationDelta } from "../../../modules/issues/issue-changes.js";
import { forbidden, labelNameTaken, notFound } from "../../../modules/issues/issues.errors.js";
import type { QueryValue } from "../connection.js";
import type { PostgresDatabase } from "../connection.js";
import type { WriteSource } from "../../../modules/identity/index.js";
import type { PublicUser } from "../../../modules/permissions/index.js";
import type { IssueEventKind, IssueState, IssueStateReason } from "../../../modules/issues/issues.types.js";
import type {
  IssueRow,
  IssueSummaryData,
  IssueDetail,
  LabelFields,
  LabelRow,
  CommentRow,
  TimelineRow,
  IssueFilter,
  IssueListPage,
  TimelineCursor,
  IssuesRepository,
  CreateIssue,
  IssueRelations,
  IssueUpdate,
} from "../../../modules/issues/issues.repository.js";

const ISSUE_SELECT = `SELECT issues.*, spaces.name AS space_name
  FROM issues JOIN spaces ON spaces.id = issues.space_id`;

export class PostgresIssuesRepository implements IssuesRepository {
  constructor(
    private readonly _database: PostgresDatabase,
    private readonly access: PostgresAccessRepository,
  ) {}

  private async issueSpace(userId: string, spaceId: string): Promise<SpaceAccess> {
    return requireIssueSpace(await this.access.readSpaceAccess(userId, spaceId));
  }

  async createIssue(input: CreateIssue): Promise<IssueDetail> {
    return await this._database.transaction(async () => {
      const space = await this.issueSpace(input.userId, input.spaceId);
      if (!space.capabilities.createIssue) throw forbidden();
      checkCreateRelations(space, input.relations);
      const number = await this.nextNumber(input.spaceId);
      await this.insertIssue({
        id: input.id, spaceId: input.spaceId, number, title: input.title,
        body: input.body, authorUserId: input.userId, now: input.now, createdVia: input.createdVia,
      });
      await this.applyRelations(input.userId, input.spaceId, input.id, input.relations, input.now);
      return await this.readIssueDetail(input.userId, space, number);
    });
  }

  async updateIssue(userId: string, spaceId: string, number: number, patch: IssueUpdate, at: number): Promise<IssueDetail> {
    return await this._database.transaction(async () => {
      const space = await this.issueSpace(userId, spaceId);
      if (!space.member) throw forbidden();
      const row = await this.readIssue(spaceId, number);
      if (!row) throw notFound();
      const { text, state, events } = planIssueUpdate(row, patch, userId, space.capabilities.triageIssues);
      if (text) await this.updateIssueText(row.id, text.title, text.body, at);
      if (state) await this.setIssueState(row.id, state.value, state.reason, state.closedBy, at);
      for (const event of events) {
        await this.insertEvent({ ...event, id: randomUUID(), issueId: row.id, actorUserId: userId, now: at });
      }
      const relationsChanged = await this.applyRelations(userId, spaceId, row.id, patch, at);
      if (text || state || relationsChanged) await this.touch(row.id, at);
      return await this.readIssueDetail(userId, space, number);
    });
  }

  async findIssue(spaceId: string, number: number): Promise<IssueRow | null> {
    return await this.readIssue(spaceId, number);
  }

  private async readIssue(spaceId: string, number: number): Promise<IssueRow | null> {
    return (await this._get(`${ISSUE_SELECT} WHERE issues.space_id = ? AND issues.number = ?`, spaceId, number) as IssueRow | undefined) ?? null;
  }

  async issueDetail(userId: string, spaceId: string, number: number): Promise<IssueDetail> {
    return await this.readIssueDetail(userId, await this.issueSpace(userId, spaceId), number);
  }

  private async readIssueDetail(userId: string, space: SpaceAccess, number: number): Promise<IssueDetail> {
    const row = await this.readIssue(space.id, number);
    if (!row) throw notFound();
    const references = await Promise.all((await this.readReferenceNodeIds(row.id)).map(async (nodeId) => ({
      nodeId, node: await this.access.readNodeAccess(userId, nodeId),
    })));
    return { row, space, summary: await this.readSummaryData([row]), references };
  }

  async listIssues(filter: IssueFilter, page: IssueListPage): Promise<IssueRow[]> {
    const where = filterClause(filter, true);
    const column = page.sort === "created" ? "created_at" : "updated_at";
    const params = [...where.params];
    let keyset = "";
    if (page.cursor) {
      const compare = page.order === "desc" ? "<" : ">";
      keyset = ` AND (issues.${column} ${compare} ? OR (issues.${column} = ? AND issues.id > ?))`;
      params.push(page.cursor.ts, page.cursor.ts, page.cursor.id);
    }
    params.push(page.limit);
    return await this._all(
      `${ISSUE_SELECT} WHERE ${where.sql}${keyset}
       ORDER BY issues.${column} ${page.order === "desc" ? "DESC" : "ASC"}, issues.id ASC LIMIT ?`,
      ...params,
    ) as unknown as IssueRow[];
  }

  async activityRows(spaceId: string, since: number, limit: number): Promise<Array<Pick<IssueRow,
    "number" | "title" | "author_user_id" | "created_via" | "created_at" | "closed_by_user_id" | "closed_at"
  >>> {
    return await this._all(
      `SELECT number, title, author_user_id, created_via, created_at, closed_by_user_id, closed_at
       FROM issues WHERE space_id = ? AND (created_at >= ? OR closed_at >= ?)
       ORDER BY GREATEST(created_at, COALESCE(closed_at, created_at)) DESC, id LIMIT ?`,
      spaceId, since, since, limit,
    ) as unknown as Array<Pick<IssueRow,
      "number" | "title" | "author_user_id" | "created_via" | "created_at" | "closed_by_user_id" | "closed_at"
    >>;
  }

  async countIssues(filter: IssueFilter): Promise<{ open: number; closed: number }> {
    const where = filterClause(filter, false);
    const rows = await this._all(
      `SELECT issues.state AS state, COUNT(*) AS count FROM issues WHERE ${where.sql} GROUP BY issues.state`,
      ...where.params,
    ) as unknown as Array<{ state: IssueState; count: number }>;
    const counts = { open: 0, closed: 0 };
    for (const row of rows) counts[row.state] = row.count;
    return counts;
  }

  async users(ids: readonly string[]): Promise<Map<string, PublicUser>> {
    return await this.readUsers(ids);
  }

  private async readUsers(ids: readonly string[]): Promise<Map<string, PublicUser>> {
    const users = new Map<string, PublicUser>();
    for (const id of new Set(ids)) {
      const row = await this._get(
        "SELECT id, username, display_name, avatar_url FROM users WHERE id = ?",
        id,
      ) as { id: string; username: string; display_name: string; avatar_url: string | null } | undefined;
      if (row) {
        users.set(row.id, {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
        });
      }
    }
    return users;
  }

  async summaryData(rows: readonly IssueRow[]): Promise<IssueSummaryData> {
    return await this.readSummaryData(rows);
  }

  private async readSummaryData(rows: readonly IssueRow[]): Promise<IssueSummaryData> {
    const ids = rows.map((row) => row.id);
    const assignees = await this.readAssigneeIds(ids);
    const users = await this.readUsers([
      ...rows.flatMap((row) => [row.author_user_id, ...(row.closed_by_user_id ? [row.closed_by_user_id] : [])]),
      ...[...assignees.values()].flat().map((entry) => entry.user_id),
    ]);
    return {
      labels: await this.readLabels(ids), assignees, users,
      commentCounts: await this._counts(ids, "issue_comments"),
      referenceCounts: await this._counts(ids, "issue_node_refs"),
    };
  }

  private async readLabels(issueIds: readonly string[]): Promise<Map<string, Array<LabelRow & { issue_id: string }>>> {
    return await this._group<LabelRow & { issue_id: string }>(
      issueIds,
      `SELECT link.issue_id AS issue_id, label.* FROM issue_label_links AS link
       JOIN issue_labels AS label ON label.id = link.label_id
       WHERE link.issue_id IN (%) ORDER BY lower(label.name COLLATE "C"), label.id`,
    );
  }

  private async readAssigneeIds(issueIds: readonly string[]): Promise<Map<string, Array<{ issue_id: string; user_id: string }>>> {
    return await this._group(
      issueIds,
      "SELECT issue_id, user_id FROM issue_assignees WHERE issue_id IN (%) ORDER BY assignment_order",
    );
  }

  private async readReferenceNodeIds(issueId: string): Promise<string[]> {
    return (await this._all("SELECT node_id FROM issue_node_refs WHERE issue_id = ? ORDER BY created_at, node_id", issueId) as unknown as Array<{ node_id: string }>).map((row) => row.node_id);
  }

  private async nextNumber(spaceId: string): Promise<number> {
    // Issues and Team Worktrees share one per-Space number sequence.
    const row = await this._get(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(number) FROM issues WHERE space_id = ?), 0),
         COALESCE((SELECT MAX(number) FROM worktrees WHERE kind = 'team' AND team_space_id = ?), 0)
       ) + 1 AS next`,
      spaceId, spaceId,
    ) as { next: number };
    return row.next;
  }

  private async insertIssue(input: {
    id: string;
    spaceId: string;
    number: number;
    title: string;
    body: string;
    authorUserId: string;
    createdVia: WriteSource | null;
    now: number;
  }): Promise<void> {
    await this._run(
      `INSERT INTO issues (id, space_id, number, title, body, state, author_user_id, created_at, updated_at, created_via)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      input.id, input.spaceId, input.number, input.title, input.body, input.authorUserId, input.now, input.now, input.createdVia,
    );
  }

  private async updateIssueText(id: string, title: string, body: string, now: number): Promise<void> {
    await this._run("UPDATE issues SET title = ?, body = ?, updated_at = ? WHERE id = ?", title, body, now, id);
  }

  private async setIssueState(
    id: string,
    state: IssueState,
    reason: IssueStateReason | null,
    closedBy: string | null,
    now: number,
  ): Promise<void> {
    await this._run(
      "UPDATE issues SET state = ?, state_reason = ?, closed_by_user_id = ?, closed_at = ?, updated_at = ? WHERE id = ?",
      state, reason, state === "closed" ? closedBy : null, state === "closed" ? now : null, now, id,
    );
  }

  private async touch(id: string, now: number): Promise<void> {
    await this._run("UPDATE issues SET updated_at = ? WHERE id = ?", now, id);
  }

  private async addLabel(issueId: string, labelId: string): Promise<void> {
    await this._run("INSERT INTO issue_label_links (issue_id, label_id) VALUES (?, ?)", issueId, labelId);
  }

  private async removeLabel(issueId: string, labelId: string): Promise<void> {
    await this._run("DELETE FROM issue_label_links WHERE issue_id = ? AND label_id = ?", issueId, labelId);
  }

  private async addAssignee(issueId: string, userId: string): Promise<void> {
    await this._run("INSERT INTO issue_assignees (issue_id, user_id) VALUES (?, ?)", issueId, userId);
  }

  private async removeAssignee(issueId: string, userId: string): Promise<void> {
    await this._run("DELETE FROM issue_assignees WHERE issue_id = ? AND user_id = ?", issueId, userId);
  }

  private async addReference(issueId: string, nodeId: string, now: number): Promise<void> {
    await this._run("INSERT INTO issue_node_refs (issue_id, node_id, created_at) VALUES (?, ?, ?)", issueId, nodeId, now);
  }

  private async removeReference(issueId: string, nodeId: string): Promise<void> {
    await this._run("DELETE FROM issue_node_refs WHERE issue_id = ? AND node_id = ?", issueId, nodeId);
  }

  private async insertEvent(input: {
    id: string;
    issueId: string;
    actorUserId: string;
    kind: IssueEventKind;
    payload: Record<string, unknown>;
    now: number;
  }): Promise<void> {
    await this._run(
      "INSERT INTO issue_events (id, issue_id, actor_user_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.id, input.issueId, input.actorUserId, input.kind, JSON.stringify(input.payload), input.now,
    );
  }

  async insertComment(input: { id: string; issueId: string; authorUserId: string; body: string; now: number }): Promise<CommentRow> {
    return await this._database.transaction(async () => {
      const issue = await this._get("SELECT space_id FROM issues WHERE id = ?", input.issueId) as { space_id: string } | undefined;
      if (!issue) throw notFound();
      if (!(await this.issueSpace(input.authorUserId, issue.space_id)).member) throw forbidden();
      await this._run(
        "INSERT INTO issue_comments (id, issue_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        input.id, input.issueId, input.authorUserId, input.body, input.now, input.now,
      );
      await this.touch(input.issueId, input.now);
      return {
        id: input.id, issue_id: input.issueId, space_id: issue.space_id, author_user_id: input.authorUserId,
        body: input.body, created_at: input.now, updated_at: input.now,
      };
    });
  }

  async findComment(id: string): Promise<CommentRow | null> {
    return await this.readComment(id);
  }

  private async readComment(id: string): Promise<CommentRow | null> {
    return (await this._get(
      `SELECT comment.*, issue.space_id AS space_id FROM issue_comments AS comment
       JOIN issues AS issue ON issue.id = comment.issue_id WHERE comment.id = ?`,
      id,
    ) as CommentRow | undefined) ?? null;
  }

  private async writableComment(userId: string, id: string, action: "update" | "delete"): Promise<CommentRow> {
    const comment = await this.readComment(id);
    if (!comment) throw notFound();
    checkCommentWrite(await this.issueSpace(userId, comment.space_id), userId, comment.author_user_id, action);
    return comment;
  }

  async updateComment(userId: string, id: string, body: string, now: number): Promise<CommentRow> {
    return await this._database.transaction(async () => {
      const comment = await this.writableComment(userId, id, "update");
      await this._run("UPDATE issue_comments SET body = ?, updated_at = ? WHERE id = ?", body, now, id);
      await this.touch(comment.issue_id, now);
      return { ...comment, body, updated_at: now };
    });
  }

  async deleteComment(userId: string, id: string, now: number): Promise<string> {
    return await this._database.transaction(async () => {
      const comment = await this.writableComment(userId, id, "delete");
      await this._run("DELETE FROM issue_comments WHERE id = ?", id);
      await this.touch(comment.issue_id, now);
      return comment.space_id;
    });
  }

  async timeline(issueId: string, cursor: TimelineCursor | null, limit: number): Promise<TimelineRow[]> {
    const keyset = cursor ? "WHERE (created_at, rank, id) > (?, ?, ?)" : "";
    const params: QueryValue[] = [issueId, issueId];
    if (cursor) params.push(cursor.ts, cursor.rank, cursor.id);
    params.push(limit);
    return await this._all(
      `SELECT * FROM (
         SELECT 'comment' AS type, 0 AS rank, id, author_user_id AS actor_user_id, body,
                NULL AS kind, NULL AS payload_json, created_at, updated_at
         FROM issue_comments WHERE issue_id = ?
         UNION ALL
         SELECT 'event', 1, id, actor_user_id, NULL, kind, payload_json, created_at, created_at
         FROM issue_events WHERE issue_id = ?
       ) ${keyset} ORDER BY created_at, rank, id LIMIT ?`,
      ...params,
    ) as unknown as TimelineRow[];
  }

  async listLabels(spaceId: string): Promise<Array<LabelRow & { open_issue_count: number }>> {
    return await this._all(
      `SELECT label.*, (
         SELECT COUNT(*) FROM issue_label_links AS link
         JOIN issues AS issue ON issue.id = link.issue_id
         WHERE link.label_id = label.id AND issue.state = 'open'
       ) AS open_issue_count
       FROM issue_labels AS label WHERE label.space_id = ? ORDER BY lower(label.name COLLATE "C"), label.id`,
      spaceId,
    ) as unknown as Array<LabelRow & { open_issue_count: number }>;
  }

  async findLabel(id: string): Promise<LabelRow | null> {
    return await this.readLabel(id);
  }

  private async readLabel(id: string): Promise<LabelRow | null> {
    return (await this._get("SELECT * FROM issue_labels WHERE id = ?", id) as LabelRow | undefined) ?? null;
  }

  private async findLabelByName(spaceId: string, name: string): Promise<LabelRow | null> {
    return (await this._get("SELECT * FROM issue_labels WHERE space_id = ? AND lower(name COLLATE \"C\") = lower(?::text COLLATE \"C\")", spaceId, name) as LabelRow | undefined) ?? null;
  }

  private async countLabels(spaceId: string): Promise<number> {
    return (await this._get("SELECT COUNT(*) AS count FROM issue_labels WHERE space_id = ?", spaceId) as { count: number }).count;
  }

  async insertLabel(userId: string, input: LabelRow & { now: number }): Promise<void> {
    await this._database.transaction(async () => {
      if (!(await this.issueSpace(userId, input.space_id)).capabilities.manageIssueLabels) throw forbidden();
      checkLabelCapacity(await this.countLabels(input.space_id));
      if (await this.findLabelByName(input.space_id, input.name)) throw labelNameTaken();
      await this._run(
        "INSERT INTO issue_labels (id, space_id, name, color, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        input.id, input.space_id, input.name, input.color, input.description, input.now, input.now,
      );
    });
  }

  private async writableLabel(userId: string, id: string): Promise<LabelRow> {
    const label = await this.readLabel(id);
    if (!label) throw notFound();
    if (!(await this.issueSpace(userId, label.space_id)).capabilities.manageIssueLabels) throw forbidden();
    return label;
  }

  async updateLabel(userId: string, id: string, patch: Partial<LabelFields>, now: number): Promise<LabelRow> {
    return await this._database.transaction(async () => {
      const label = { ...await this.writableLabel(userId, id), ...patch };
      const clash = await this.findLabelByName(label.space_id, label.name);
      if (clash && clash.id !== id) throw labelNameTaken();
      await this._run(
        "UPDATE issue_labels SET name = ?, color = ?, description = ?, updated_at = ? WHERE id = ?",
        label.name, label.color, label.description, now, id,
      );
      return label;
    });
  }

  async deleteLabel(userId: string, id: string): Promise<string> {
    return await this._database.transaction(async () => {
      const label = await this.writableLabel(userId, id);
      await this._run("DELETE FROM issue_labels WHERE id = ?", id);
      return label.space_id;
    });
  }

  private async isSpaceParticipant(spaceId: string, userId: string): Promise<boolean> {
    return Boolean(await this._get(
      `SELECT 1 FROM spaces WHERE id = ? AND type = 'team' AND (
         owner_user_id = ? OR EXISTS (SELECT 1 FROM space_members WHERE space_id = spaces.id AND user_id = ?))`,
      spaceId, userId, userId,
    ));
  }

  async audience(spaceId: string): Promise<string[]> {
    return (await this._all(
      `SELECT owner_user_id AS user_id FROM spaces WHERE id = ?
       UNION SELECT user_id FROM space_members WHERE space_id = ? ORDER BY user_id`,
      spaceId, spaceId,
    ) as unknown as Array<{ user_id: string }>).map((row) => row.user_id);
  }

  /** Diff the requested relation sets against the stored ones and record one event per change. */
  private async applyRelations(
    userId: string,
    spaceId: string,
    issueId: string,
    desired: IssueRelations,
    at: number,
  ): Promise<boolean> {
    let changed = false;
    const recordEvent = async (event: { kind: IssueEventKind; payload: Record<string, unknown> }) => {
      await this.insertEvent({ ...event, id: randomUUID(), issueId, actorUserId: userId, now: at });
      changed = true;
    };
    if (desired.labelIds) {
      const current = new Map(((await this.readLabels([issueId])).get(issueId) ?? []).map((label) => [label.id, label]));
      const delta = relationDelta("labelIds", [...current.keys()], desired.labelIds);
      for (const id of delta.removed) {
        await this.removeLabel(issueId, id);
        await recordEvent(labelEvent("unlabeled", spaceId, current.get(id)!));
      }
      for (const id of delta.added) {
        const event = labelEvent("labeled", spaceId, await this.readLabel(id));
        await this.addLabel(issueId, id);
        await recordEvent(event);
      }
    }
    if (desired.assigneeUserIds) {
      const current = (await this.readAssigneeIds([issueId])).get(issueId)?.map((row) => row.user_id) ?? [];
      const delta = relationDelta("assigneeUserIds", current, desired.assigneeUserIds);
      const users = await this.readUsers([...delta.removed, ...delta.added]);
      for (const id of delta.removed) {
        await this.removeAssignee(issueId, id);
        await recordEvent(assigneeEvent("unassigned", id, users.get(id)));
      }
      for (const id of delta.added) {
        const event = assigneeEvent("assigned", id, users.get(id), await this.isSpaceParticipant(spaceId, id));
        await this.addAssignee(issueId, id);
        await recordEvent(event);
      }
    }
    if (desired.nodeIds) {
      const delta = relationDelta("nodeIds", await this.readReferenceNodeIds(issueId), desired.nodeIds);
      for (const id of delta.removed) {
        await this.removeReference(issueId, id);
        await recordEvent(referenceEvent("node_unreferenced", id, spaceId, await this.access.readNodeAccess(userId, id)));
      }
      for (const id of delta.added) {
        const event = referenceEvent("node_referenced", id, spaceId, await this.access.readNodeAccess(userId, id));
        await this.addReference(issueId, id, at);
        await recordEvent(event);
      }
    }
    return changed;
  }

  private async _get(sql: string, ...params: QueryValue[]): Promise<unknown> {
    return await this._database.prepare(sql).get(...params);
  }

  private async _all(sql: string, ...params: QueryValue[]): Promise<unknown[]> {
    return await this._database.prepare(sql).all(...params);
  }

  private async _run(sql: string, ...params: QueryValue[]): Promise<void> {
    await this._database.prepare(sql).run(...params);
  }

  private async _counts(issueIds: readonly string[], table: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (issueIds.length === 0) return counts;
    const rows = await this._all(
      `SELECT issue_id, COUNT(*) AS count FROM ${table} WHERE issue_id IN (${placeholders(issueIds)}) GROUP BY issue_id`,
      ...issueIds,
    ) as unknown as Array<{ issue_id: string; count: number }>;
    for (const row of rows) counts.set(row.issue_id, row.count);
    return counts;
  }

  private async _group<T extends { issue_id: string }>(issueIds: readonly string[], sql: string): Promise<Map<string, T[]>> {
    const groups = new Map<string, T[]>();
    if (issueIds.length === 0) return groups;
    const rows = await this._all(sql.replace("%", placeholders(issueIds)), ...issueIds) as unknown as T[];
    for (const row of rows) {
      const group = groups.get(row.issue_id) ?? [];
      group.push(row);
      groups.set(row.issue_id, group);
    }
    return groups;
  }
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function filterClause(filter: IssueFilter, includeState: boolean): { sql: string; params: QueryValue[] } {
  const clauses: string[] = [];
  const params: QueryValue[] = [];
  if (filter.scope.kind === "space") {
    clauses.push("issues.space_id = ?");
    params.push(filter.scope.spaceId);
  } else {
    clauses.push(`issues.space_id IN (
      SELECT id FROM spaces WHERE type = 'team' AND (
        owner_user_id = ? OR EXISTS (SELECT 1 FROM space_members WHERE space_id = spaces.id AND user_id = ?)))`);
    params.push(filter.scope.userId, filter.scope.userId);
  }
  if (includeState && filter.state !== "all") {
    clauses.push("issues.state = ?");
    params.push(filter.state);
  }
  for (const name of filter.labelNames) {
    clauses.push(`EXISTS (SELECT 1 FROM issue_label_links AS link JOIN issue_labels AS label ON label.id = link.label_id
      WHERE link.issue_id = issues.id AND lower(label.name COLLATE "C") = lower(?::text COLLATE "C"))`);
    params.push(name);
  }
  if (filter.assignee === "none") {
    clauses.push("NOT EXISTS (SELECT 1 FROM issue_assignees WHERE issue_id = issues.id)");
  } else if (filter.assignee) {
    clauses.push("EXISTS (SELECT 1 FROM issue_assignees WHERE issue_id = issues.id AND user_id = ?)");
    params.push(filter.assignee.userId);
  }
  if (filter.authorUserId) {
    clauses.push("issues.author_user_id = ?");
    params.push(filter.authorUserId);
  }
  if (filter.search) {
    const pattern = `%${filter.search.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push("(issues.title ILIKE ? ESCAPE '\\' OR issues.body ILIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  return { sql: clauses.join(" AND "), params };
}
