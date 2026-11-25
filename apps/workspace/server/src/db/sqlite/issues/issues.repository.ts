import { randomUUID } from "node:crypto";
import type { SpaceAccess } from "../../../modules/access/index.js";
import { type SqliteAccessRepository, ownerSuspendedSql, ownsSpaceSql, spaceOwnerIdsSql } from "../access/access.repository.js";
import { assigneeEvent, checkCommentWrite, checkCreateRelations, checkLabelCapacity, requireIssueSpace, labelEvent, planIssueUpdate, planVerdict, referenceEvent, relationDelta } from "../../../modules/issues/issue-changes.js";
import { forbidden, labelNameTaken, notFound } from "../../../modules/issues/issues.errors.js";
import type { SQLInputValue } from "node:sqlite";
import type { SqliteDatabase } from "../connection.js";
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
  AssignmentRow,
  IssueFilter,
  IssueListPage,
  TimelineCursor,
  IssuesRepository,
  CreateIssue,
  IssueRelations,
  IssueUpdate,
  RecordVerdict,
  VerdictRow,
  DueIssue,
} from "../../../modules/issues/issues.repository.js";

const ISSUE_SELECT = `SELECT issues.*, spaces.name AS space_name
  FROM issues JOIN spaces ON spaces.id = issues.space_id`;

/** Binds the User three times. Owners always take part in a Space, its members only while it is not suspended. */
const participantSql = `(${ownsSpaceSql("spaces.owner_user_id", "?")} OR (
  NOT ${ownerSuspendedSql("spaces.owner_user_id")}
  AND EXISTS (SELECT 1 FROM space_members WHERE space_id = spaces.id AND user_id = ?)))`;

/** When the Space's deadline accepts each open, submitted Issue. The job and the Issue view both read it. */
const PENDING_SQL = `SELECT issues.id, issues.space_id, verdict.created_at AS submitted_at,
    MAX(verdict.created_at, COALESCE((
      SELECT MAX(created_at) FROM issue_events WHERE issue_id = issues.id AND kind = 'reopened'), 0)
    ) + spaces.accept_after_hours * 3600000 AS accept_at
  FROM issues
  JOIN spaces ON spaces.id = issues.space_id
  JOIN issue_verdicts AS verdict ON verdict.id = (
    SELECT id FROM issue_verdicts WHERE issue_id = issues.id ORDER BY created_at DESC, id DESC LIMIT 1)
  WHERE issues.state = 'open' AND verdict.kind = 'submitted' AND spaces.accept_after_hours IS NOT NULL
    AND NOT ${ownerSuspendedSql("spaces.owner_user_id")}`;

export class SqliteIssuesRepository implements IssuesRepository {
  constructor(
    private readonly _database: SqliteDatabase,
    private readonly access: SqliteAccessRepository,
  ) {}

  private issueSpace(userId: string, spaceId: string): SpaceAccess {
    return requireIssueSpace(this.access.readSpaceAccess(userId, spaceId));
  }

  async createIssue(input: CreateIssue): Promise<IssueDetail> {
    return this._database.transaction(() => {
      const space = this.issueSpace(input.userId, input.spaceId);
      if (!space.capabilities.createIssue) throw forbidden();
      checkCreateRelations(space, input.relations);
      const number = this.nextNumber(input.spaceId);
      this.insertIssue({
        id: input.id, spaceId: input.spaceId, number, title: input.title,
        body: input.body, authorUserId: input.userId, now: input.now, createdVia: input.createdVia,
      });
      this.applyRelations(input.userId, input.spaceId, input.id, input.relations, input.now);
      return this.readIssueDetail(input.userId, space, number);
    });
  }

  async updateIssue(userId: string, spaceId: string, number: number, patch: IssueUpdate, at: number): Promise<IssueDetail> {
    return this._database.transaction(() => {
      const space = this.issueSpace(userId, spaceId);
      if (!space.member) throw forbidden();
      const row = this.readIssue(spaceId, number);
      if (!row) throw notFound();
      this.applyUpdate(userId, space, row, patch, at);
      return this.readIssueDetail(userId, space, number);
    });
  }

  private applyUpdate(userId: string, space: SpaceAccess, row: IssueRow, patch: IssueUpdate, at: number): void {
    const { text, state, events } = planIssueUpdate(row, patch, userId, space.capabilities.triageIssues);
    if (text) this.updateIssueText(row.id, text.title, text.body, at);
    if (state) this.setIssueState(row.id, state.value, state.reason, state.closedBy, at);
    for (const event of events) {
      this.insertEvent({ ...event, id: randomUUID(), issueId: row.id, actorUserId: userId, now: at });
    }
    const relationsChanged = this.applyRelations(userId, space.id, row.id, patch, at);
    if (text || state || relationsChanged) this.touch(row.id, at);
  }

  async recordVerdict(input: RecordVerdict): Promise<IssueDetail> {
    return this._database.transaction(() => {
      const space = this.issueSpace(input.userId, input.spaceId);
      const row = this.readIssue(input.spaceId, input.number);
      if (!row) throw notFound();
      const plan = planVerdict({
        issue: row, latest: this.readLatestVerdict(row.id), space, userId: input.userId, kind: input.kind,
        body: input.body, now: input.now,
        assignee: Boolean(this._get("SELECT 1 FROM issue_assignees WHERE issue_id = ? AND user_id = ?", row.id, input.userId)),
      });
      if (plan) {
        this._run(
          "INSERT INTO issue_verdicts (id, issue_id, kind, actor_user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          input.id, row.id, input.kind, input.userId, input.body, plan.createdAt,
        );
        if (input.kind === "accepted") {
          this.applyUpdate(input.userId, space, row, { state: "closed", stateReason: "completed" }, plan.createdAt);
        } else {
          this.touch(row.id, plan.createdAt);
        }
      }
      return this.readIssueDetail(input.userId, space, input.number);
    });
  }

  async listDueIssues(now: number, limit: number): Promise<DueIssue[]> {
    return this._all(
      `SELECT id FROM (${PENDING_SQL}) WHERE accept_at <= ? ORDER BY random() LIMIT ?`,
      now, limit,
    ) as unknown as DueIssue[];
  }

  async acceptDueIssue(issueId: string, now: number): Promise<string | null> {
    return this._database.transaction(() => {
      const row = this._get(`SELECT * FROM (${PENDING_SQL} AND issues.id = ?) WHERE accept_at <= ?`, issueId, now) as
        { space_id: string; submitted_at: number } | undefined;
      if (!row) return null;
      const at = Math.max(now, row.submitted_at + 1);
      this._run(
        "INSERT INTO issue_verdicts (id, issue_id, kind, actor_user_id, body, created_at) VALUES (?, ?, 'accepted', NULL, '', ?)",
        randomUUID(), issueId, at,
      );
      this.setIssueState(issueId, "closed", "completed", null, at);
      return row.space_id;
    });
  }

  private readLatestVerdict(issueId: string): VerdictRow | null {
    return (this._get(
      "SELECT id, kind, actor_user_id, body, created_at FROM issue_verdicts WHERE issue_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      issueId,
    ) as VerdictRow | undefined) ?? null;
  }

  async findIssue(spaceId: string, number: number): Promise<IssueRow | null> {
    return this.readIssue(spaceId, number);
  }

  private readIssue(spaceId: string, number: number): IssueRow | null {
    return (this._get(`${ISSUE_SELECT} WHERE issues.space_id = ? AND issues.number = ?`, spaceId, number) as IssueRow | undefined) ?? null;
  }

  async issueDetail(userId: string, spaceId: string, number: number): Promise<IssueDetail> {
    return this.readIssueDetail(userId, this.issueSpace(userId, spaceId), number);
  }

  private readIssueDetail(userId: string, space: SpaceAccess, number: number): IssueDetail {
    const row = this.readIssue(space.id, number);
    if (!row) throw notFound();
    const references = this.readReferenceNodeIds(row.id).map((nodeId) => ({
      nodeId, node: this.access.readNodeAccess(userId, nodeId),
    }));
    const pending = this._get(`SELECT accept_at FROM (${PENDING_SQL} AND issues.id = ?)`, row.id) as { accept_at: number } | undefined;
    return {
      row, space, summary: this.readSummaryData([row]), references,
      acceptance: this.readLatestVerdict(row.id), acceptAt: pending?.accept_at ?? null,
    };
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
    return this._all(
      `${ISSUE_SELECT} WHERE ${where.sql}${keyset}
       ORDER BY issues.${column} ${page.order === "desc" ? "DESC" : "ASC"}, issues.id ASC LIMIT ?`,
      ...params,
    ) as unknown as IssueRow[];
  }

  async activityRows(spaceId: string, since: number, limit: number): Promise<Array<Pick<IssueRow,
    "number" | "title" | "author_user_id" | "created_via" | "created_at" | "closed_by_user_id" | "closed_at"
  >>> {
    return this._all(
      `SELECT number, title, author_user_id, created_via, created_at, closed_by_user_id, closed_at
       FROM issues WHERE space_id = ? AND (created_at >= ? OR closed_at >= ?)
       ORDER BY MAX(created_at, COALESCE(closed_at, created_at)) DESC, id LIMIT ?`,
      spaceId, since, since, limit,
    ) as unknown as Array<Pick<IssueRow,
      "number" | "title" | "author_user_id" | "created_via" | "created_at" | "closed_by_user_id" | "closed_at"
    >>;
  }

  async countIssues(filter: IssueFilter): Promise<{ open: number; closed: number }> {
    const where = filterClause(filter, false);
    const rows = this._all(
      `SELECT issues.state AS state, COUNT(*) AS count FROM issues WHERE ${where.sql} GROUP BY issues.state`,
      ...where.params,
    ) as unknown as Array<{ state: IssueState; count: number }>;
    const counts = { open: 0, closed: 0 };
    for (const row of rows) counts[row.state] = row.count;
    return counts;
  }

  async users(ids: readonly string[]): Promise<Map<string, PublicUser>> {
    return this.readUsers(ids);
  }

  private readUsers(ids: readonly string[]): Map<string, PublicUser> {
    const users = new Map<string, PublicUser>();
    for (const id of new Set(ids)) {
      const row = this._get(
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
    return this.readSummaryData(rows);
  }

  private readSummaryData(rows: readonly IssueRow[]): IssueSummaryData {
    const ids = rows.map((row) => row.id);
    const assignees = this.readAssigneeIds(ids);
    const users = this.readUsers([
      ...rows.flatMap((row) => [row.author_user_id, ...(row.closed_by_user_id ? [row.closed_by_user_id] : [])]),
      ...[...assignees.values()].flat().map((entry) => entry.user_id),
    ]);
    return {
      labels: this.readLabels(ids), assignees, users,
      commentCounts: this._counts(ids, "issue_comments"),
      referenceCounts: this._counts(ids, "issue_node_refs"),
    };
  }

  private readLabels(issueIds: readonly string[]): Map<string, Array<LabelRow & { issue_id: string }>> {
    return this._group<LabelRow & { issue_id: string }>(
      issueIds,
      `SELECT link.issue_id AS issue_id, label.* FROM issue_label_links AS link
       JOIN issue_labels AS label ON label.id = link.label_id
       WHERE link.issue_id IN (%) ORDER BY label.name COLLATE NOCASE, label.id`,
    );
  }

  private readAssigneeIds(issueIds: readonly string[]): Map<string, Array<{ issue_id: string; user_id: string }>> {
    return this._group(
      issueIds,
      "SELECT issue_id, user_id FROM issue_assignees WHERE issue_id IN (%) ORDER BY rowid",
    );
  }

  private readReferenceNodeIds(issueId: string): string[] {
    return (this._all("SELECT node_id FROM issue_node_refs WHERE issue_id = ? ORDER BY created_at, node_id", issueId) as unknown as Array<{ node_id: string }>).map((row) => row.node_id);
  }

  private nextNumber(spaceId: string): number {
    // Issues and Team Worktrees share one per-Space number sequence.
    const row = this._get(
      `SELECT MAX(
         COALESCE((SELECT MAX(number) FROM issues WHERE space_id = ?), 0),
         COALESCE((SELECT MAX(number) FROM worktrees WHERE kind = 'team' AND team_space_id = ?), 0)
       ) + 1 AS next`,
      spaceId, spaceId,
    ) as { next: number };
    return row.next;
  }

  private insertIssue(input: {
    id: string;
    spaceId: string;
    number: number;
    title: string;
    body: string;
    authorUserId: string;
    createdVia: WriteSource | null;
    now: number;
  }): void {
    this._run(
      `INSERT INTO issues (id, space_id, number, title, body, state, author_user_id, created_at, updated_at, created_via)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      input.id, input.spaceId, input.number, input.title, input.body, input.authorUserId, input.now, input.now, input.createdVia,
    );
  }

  private updateIssueText(id: string, title: string, body: string, now: number): void {
    this._run("UPDATE issues SET title = ?, body = ?, updated_at = ? WHERE id = ?", title, body, now, id);
  }

  private setIssueState(
    id: string,
    state: IssueState,
    reason: IssueStateReason | null,
    closedBy: string | null,
    now: number,
  ): void {
    this._run(
      "UPDATE issues SET state = ?, state_reason = ?, closed_by_user_id = ?, closed_at = ?, updated_at = ? WHERE id = ?",
      state, reason, state === "closed" ? closedBy : null, state === "closed" ? now : null, now, id,
    );
  }

  private touch(id: string, now: number): void {
    this._run("UPDATE issues SET updated_at = ? WHERE id = ?", now, id);
  }

  private addLabel(issueId: string, labelId: string): void {
    this._run("INSERT INTO issue_label_links (issue_id, label_id) VALUES (?, ?)", issueId, labelId);
  }

  private removeLabel(issueId: string, labelId: string): void {
    this._run("DELETE FROM issue_label_links WHERE issue_id = ? AND label_id = ?", issueId, labelId);
  }

  private addAssignee(issueId: string, userId: string): void {
    this._run("INSERT INTO issue_assignees (issue_id, user_id) VALUES (?, ?)", issueId, userId);
  }

  private removeAssignee(issueId: string, userId: string): void {
    this._run("DELETE FROM issue_assignees WHERE issue_id = ? AND user_id = ?", issueId, userId);
  }

  private addReference(issueId: string, nodeId: string, now: number): void {
    this._run("INSERT INTO issue_node_refs (issue_id, node_id, created_at) VALUES (?, ?, ?)", issueId, nodeId, now);
  }

  private removeReference(issueId: string, nodeId: string): void {
    this._run("DELETE FROM issue_node_refs WHERE issue_id = ? AND node_id = ?", issueId, nodeId);
  }

  private insertEvent(input: {
    id: string;
    issueId: string;
    actorUserId: string;
    kind: IssueEventKind;
    payload: Record<string, unknown>;
    now: number;
  }): void {
    this._run(
      "INSERT INTO issue_events (id, issue_id, actor_user_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.id, input.issueId, input.actorUserId, input.kind, JSON.stringify(input.payload), input.now,
    );
  }

  async insertComment(input: { id: string; issueId: string; authorUserId: string; body: string; now: number }): Promise<CommentRow> {
    return this._database.transaction(() => {
      const issue = this._get("SELECT space_id FROM issues WHERE id = ?", input.issueId) as { space_id: string } | undefined;
      if (!issue) throw notFound();
      if (!this.issueSpace(input.authorUserId, issue.space_id).member) throw forbidden();
      this._run(
        "INSERT INTO issue_comments (id, issue_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        input.id, input.issueId, input.authorUserId, input.body, input.now, input.now,
      );
      this.touch(input.issueId, input.now);
      return {
        id: input.id, issue_id: input.issueId, space_id: issue.space_id, author_user_id: input.authorUserId,
        body: input.body, created_at: input.now, updated_at: input.now,
      };
    });
  }

  async findComment(id: string): Promise<CommentRow | null> {
    return this.readComment(id);
  }

  private readComment(id: string): CommentRow | null {
    return (this._get(
      `SELECT comment.*, issue.space_id AS space_id FROM issue_comments AS comment
       JOIN issues AS issue ON issue.id = comment.issue_id WHERE comment.id = ?`,
      id,
    ) as CommentRow | undefined) ?? null;
  }

  private writableComment(userId: string, id: string, action: "update" | "delete"): CommentRow {
    const comment = this.readComment(id);
    if (!comment) throw notFound();
    checkCommentWrite(this.issueSpace(userId, comment.space_id), userId, comment.author_user_id, action);
    return comment;
  }

  async updateComment(userId: string, id: string, body: string, now: number): Promise<CommentRow> {
    return this._database.transaction(() => {
      const comment = this.writableComment(userId, id, "update");
      this._run("UPDATE issue_comments SET body = ?, updated_at = ? WHERE id = ?", body, now, id);
      this.touch(comment.issue_id, now);
      return { ...comment, body, updated_at: now };
    });
  }

  async deleteComment(userId: string, id: string, now: number): Promise<string> {
    return this._database.transaction(() => {
      const comment = this.writableComment(userId, id, "delete");
      this._run("DELETE FROM issue_comments WHERE id = ?", id);
      this.touch(comment.issue_id, now);
      return comment.space_id;
    });
  }

  async timeline(issueId: string, cursor: TimelineCursor | null, limit: number): Promise<TimelineRow[]> {
    const keyset = cursor ? "WHERE (created_at, rank, id) > (?, ?, ?)" : "";
    const params: SQLInputValue[] = [issueId, issueId, issueId];
    if (cursor) params.push(cursor.ts, cursor.rank, cursor.id);
    params.push(limit);
    return this._all(
      `SELECT * FROM (
         SELECT 'comment' AS type, 0 AS rank, id, author_user_id AS actor_user_id, body,
                NULL AS kind, NULL AS payload_json, created_at, updated_at
         FROM issue_comments WHERE issue_id = ?
         UNION ALL
         SELECT 'event', 1, id, actor_user_id, NULL, kind, payload_json, created_at, created_at
         FROM issue_events WHERE issue_id = ?
         UNION ALL
         SELECT 'verdict', 2, id, actor_user_id, body, kind, NULL, created_at, created_at
         FROM issue_verdicts WHERE issue_id = ?
       ) ${keyset} ORDER BY created_at, rank, id LIMIT ?`,
      ...params,
    ) as unknown as TimelineRow[];
  }

  async assignments(issueId: string): Promise<AssignmentRow[]> {
    return this._all(
      `SELECT assignees.user_id, MAX(events.created_at) AS assigned_at
       FROM issue_assignees AS assignees
       JOIN issue_events AS events ON events.issue_id = assignees.issue_id AND events.kind = 'assigned'
         AND json_extract(events.payload_json, '$.userId') = assignees.user_id
       WHERE assignees.issue_id = ?
       GROUP BY assignees.user_id`,
      issueId,
    ) as unknown as AssignmentRow[];
  }

  async listLabels(spaceId: string): Promise<Array<LabelRow & { open_issue_count: number }>> {
    return this._all(
      `SELECT label.*, (
         SELECT COUNT(*) FROM issue_label_links AS link
         JOIN issues AS issue ON issue.id = link.issue_id
         WHERE link.label_id = label.id AND issue.state = 'open'
       ) AS open_issue_count
       FROM issue_labels AS label WHERE label.space_id = ? ORDER BY label.name COLLATE NOCASE, label.id`,
      spaceId,
    ) as unknown as Array<LabelRow & { open_issue_count: number }>;
  }

  async findLabel(id: string): Promise<LabelRow | null> {
    return this.readLabel(id);
  }

  private readLabel(id: string): LabelRow | null {
    return (this._get("SELECT * FROM issue_labels WHERE id = ?", id) as LabelRow | undefined) ?? null;
  }

  private findLabelByName(spaceId: string, name: string): LabelRow | null {
    return (this._get("SELECT * FROM issue_labels WHERE space_id = ? AND name = ? COLLATE NOCASE", spaceId, name) as LabelRow | undefined) ?? null;
  }

  private countLabels(spaceId: string): number {
    return (this._get("SELECT COUNT(*) AS count FROM issue_labels WHERE space_id = ?", spaceId) as { count: number }).count;
  }

  async insertLabel(userId: string, input: LabelRow & { now: number }): Promise<void> {
    this._database.transaction(() => {
      if (!this.issueSpace(userId, input.space_id).capabilities.manageIssueLabels) throw forbidden();
      checkLabelCapacity(this.countLabels(input.space_id));
      if (this.findLabelByName(input.space_id, input.name)) throw labelNameTaken();
      this._run(
        "INSERT INTO issue_labels (id, space_id, name, color, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        input.id, input.space_id, input.name, input.color, input.description, input.now, input.now,
      );
    });
  }

  private writableLabel(userId: string, id: string): LabelRow {
    const label = this.readLabel(id);
    if (!label) throw notFound();
    if (!this.issueSpace(userId, label.space_id).capabilities.manageIssueLabels) throw forbidden();
    return label;
  }

  async updateLabel(userId: string, id: string, patch: Partial<LabelFields>, now: number): Promise<LabelRow> {
    return this._database.transaction(() => {
      const label = { ...this.writableLabel(userId, id), ...patch };
      const clash = this.findLabelByName(label.space_id, label.name);
      if (clash && clash.id !== id) throw labelNameTaken();
      this._run(
        "UPDATE issue_labels SET name = ?, color = ?, description = ?, updated_at = ? WHERE id = ?",
        label.name, label.color, label.description, now, id,
      );
      return label;
    });
  }

  async deleteLabel(userId: string, id: string): Promise<string> {
    return this._database.transaction(() => {
      const label = this.writableLabel(userId, id);
      this._run("DELETE FROM issue_labels WHERE id = ?", id);
      return label.space_id;
    });
  }

  private isSpaceParticipant(spaceId: string, userId: string): boolean {
    return Boolean(this._get(
      `SELECT 1 FROM spaces WHERE id = ? AND type = 'team' AND ${participantSql}`,
      spaceId, userId, userId, userId,
    ));
  }

  async audience(spaceId: string): Promise<string[]> {
    return (this._all(
      `${spaceOwnerIdsSql("SELECT owner_user_id AS user_id FROM spaces WHERE id = ?")}
       UNION SELECT space_members.user_id FROM space_members JOIN spaces ON spaces.id = space_members.space_id
       WHERE space_members.space_id = ? AND NOT ${ownerSuspendedSql("spaces.owner_user_id")}
       ORDER BY user_id`,
      spaceId, spaceId, spaceId,
    ) as unknown as Array<{ user_id: string }>).map((row) => row.user_id);
  }

  /** Diff the requested relation sets against the stored ones and record one event per change. */
  private applyRelations(
    userId: string,
    spaceId: string,
    issueId: string,
    desired: IssueRelations,
    at: number,
  ): boolean {
    let changed = false;
    const recordEvent = (event: { kind: IssueEventKind; payload: Record<string, unknown> }) => {
      this.insertEvent({ ...event, id: randomUUID(), issueId, actorUserId: userId, now: at });
      changed = true;
    };
    if (desired.labelIds) {
      const current = new Map((this.readLabels([issueId]).get(issueId) ?? []).map((label) => [label.id, label]));
      const delta = relationDelta("labelIds", [...current.keys()], desired.labelIds);
      for (const id of delta.removed) {
        this.removeLabel(issueId, id);
        recordEvent(labelEvent("unlabeled", spaceId, current.get(id)!));
      }
      for (const id of delta.added) {
        const event = labelEvent("labeled", spaceId, this.readLabel(id));
        this.addLabel(issueId, id);
        recordEvent(event);
      }
    }
    if (desired.assigneeUserIds) {
      const current = this.readAssigneeIds([issueId]).get(issueId)?.map((row) => row.user_id) ?? [];
      const delta = relationDelta("assigneeUserIds", current, desired.assigneeUserIds);
      const users = this.readUsers([...delta.removed, ...delta.added]);
      for (const id of delta.removed) {
        this.removeAssignee(issueId, id);
        recordEvent(assigneeEvent("unassigned", id, users.get(id)));
      }
      for (const id of delta.added) {
        const event = assigneeEvent("assigned", id, users.get(id), this.isSpaceParticipant(spaceId, id));
        this.addAssignee(issueId, id);
        recordEvent(event);
      }
    }
    if (desired.nodeIds) {
      const delta = relationDelta("nodeIds", this.readReferenceNodeIds(issueId), desired.nodeIds);
      for (const id of delta.removed) {
        this.removeReference(issueId, id);
        recordEvent(referenceEvent("node_unreferenced", id, spaceId, this.access.readNodeAccess(userId, id)));
      }
      for (const id of delta.added) {
        const event = referenceEvent("node_referenced", id, spaceId, this.access.readNodeAccess(userId, id));
        this.addReference(issueId, id, at);
        recordEvent(event);
      }
    }
    return changed;
  }

  private _get(sql: string, ...params: SQLInputValue[]): unknown {
    return this._database.connection.prepare(sql).get(...params);
  }

  private _all(sql: string, ...params: SQLInputValue[]): unknown[] {
    return this._database.connection.prepare(sql).all(...params);
  }

  private _run(sql: string, ...params: SQLInputValue[]): void {
    this._database.connection.prepare(sql).run(...params);
  }

  private _counts(issueIds: readonly string[], table: string): Map<string, number> {
    const counts = new Map<string, number>();
    if (issueIds.length === 0) return counts;
    const rows = this._all(
      `SELECT issue_id, COUNT(*) AS count FROM ${table} WHERE issue_id IN (${placeholders(issueIds)}) GROUP BY issue_id`,
      ...issueIds,
    ) as unknown as Array<{ issue_id: string; count: number }>;
    for (const row of rows) counts.set(row.issue_id, row.count);
    return counts;
  }

  private _group<T extends { issue_id: string }>(issueIds: readonly string[], sql: string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    if (issueIds.length === 0) return groups;
    const rows = this._all(sql.replace("%", placeholders(issueIds)), ...issueIds) as unknown as T[];
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

function filterClause(filter: IssueFilter, includeState: boolean): { sql: string; params: SQLInputValue[] } {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.scope.kind === "space") {
    clauses.push("issues.space_id = ?");
    params.push(filter.scope.spaceId);
  } else {
    clauses.push(`issues.space_id IN (SELECT id FROM spaces WHERE type = 'team' AND ${participantSql})`);
    params.push(filter.scope.userId, filter.scope.userId, filter.scope.userId);
  }
  if (includeState && filter.state !== "all") {
    clauses.push("issues.state = ?");
    params.push(filter.state);
  }
  for (const name of filter.labelNames) {
    clauses.push(`EXISTS (SELECT 1 FROM issue_label_links AS link JOIN issue_labels AS label ON label.id = link.label_id
      WHERE link.issue_id = issues.id AND label.name = ? COLLATE NOCASE)`);
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
    clauses.push("(issues.title LIKE ? ESCAPE '\\' OR issues.body LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (filter.acceptance) {
    clauses.push(`(SELECT kind FROM issue_verdicts WHERE issue_id = issues.id
      ORDER BY created_at DESC, id DESC LIMIT 1) = ?`);
    params.push(filter.acceptance);
  }
  return { sql: clauses.join(" AND "), params };
}
