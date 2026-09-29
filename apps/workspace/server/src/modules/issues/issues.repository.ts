import type { SQLInputValue } from "node:sqlite";
import type { WorkspaceDatabase } from "../../db/database.js";
import type { PublicUser } from "../permissions/index.js";
import type { IssueEventKind, IssueState, IssueStateReason } from "./issues.types.js";

export interface IssueRow {
  readonly id: string;
  readonly space_id: string;
  readonly space_name: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: IssueState;
  readonly state_reason: IssueStateReason | null;
  readonly author_user_id: string;
  readonly closed_by_user_id: string | null;
  readonly closed_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface LabelRow {
  readonly id: string;
  readonly space_id: string;
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface CommentRow {
  readonly id: string;
  readonly issue_id: string;
  readonly space_id: string;
  readonly author_user_id: string;
  readonly body: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface TimelineRow {
  readonly type: "comment" | "event";
  readonly id: string;
  readonly actor_user_id: string;
  readonly body: string | null;
  readonly kind: IssueEventKind | null;
  readonly payload_json: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface IssueFilter {
  readonly scope:
    | { readonly kind: "space"; readonly spaceId: string }
    | { readonly kind: "member"; readonly userId: string };
  readonly state: IssueState | "all";
  readonly labelNames: readonly string[];
  readonly assignee: { readonly userId: string } | "none" | null;
  readonly authorUserId: string | null;
  readonly search: string | null;
}

export interface IssueListPage {
  readonly sort: "created" | "updated";
  readonly order: "asc" | "desc";
  readonly cursor: { readonly ts: number; readonly id: string } | null;
  readonly limit: number;
}

export interface TimelineCursor {
  readonly ts: number;
  readonly rank: number;
  readonly id: string;
}

const ISSUE_SELECT = `SELECT issues.*, spaces.name AS space_name
  FROM issues JOIN spaces ON spaces.id = issues.space_id`;

export class IssuesRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  transaction<T>(operation: () => T): T {
    return this._database.transaction(() => operation());
  }

  findIssue(spaceId: string, number: number): IssueRow | null {
    return (this._get(`${ISSUE_SELECT} WHERE issues.space_id = ? AND issues.number = ?`, spaceId, number) as IssueRow | undefined) ?? null;
  }

  findIssueById(id: string): IssueRow | null {
    return (this._get(`${ISSUE_SELECT} WHERE issues.id = ?`, id) as IssueRow | undefined) ?? null;
  }

  listIssues(filter: IssueFilter, page: IssueListPage): IssueRow[] {
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

  countIssues(filter: IssueFilter): { open: number; closed: number } {
    const where = filterClause(filter, false);
    const rows = this._all(
      `SELECT issues.state AS state, COUNT(*) AS count FROM issues WHERE ${where.sql} GROUP BY issues.state`,
      ...where.params,
    ) as unknown as Array<{ state: IssueState; count: number }>;
    const counts = { open: 0, closed: 0 };
    for (const row of rows) counts[row.state] = row.count;
    return counts;
  }

  users(ids: readonly string[]): Map<string, PublicUser> {
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

  labelsFor(issueIds: readonly string[]): Map<string, Array<LabelRow & { issue_id: string }>> {
    return this._group<LabelRow & { issue_id: string }>(
      issueIds,
      `SELECT link.issue_id AS issue_id, label.* FROM issue_label_links AS link
       JOIN issue_labels AS label ON label.id = link.label_id
       WHERE link.issue_id IN (%) ORDER BY label.name COLLATE NOCASE, label.id`,
    );
  }

  assigneeIdsFor(issueIds: readonly string[]): Map<string, Array<{ issue_id: string; user_id: string }>> {
    return this._group(
      issueIds,
      "SELECT issue_id, user_id FROM issue_assignees WHERE issue_id IN (%) ORDER BY rowid",
    );
  }

  commentCounts(issueIds: readonly string[]): Map<string, number> {
    return this._counts(issueIds, "issue_comments");
  }

  referenceCounts(issueIds: readonly string[]): Map<string, number> {
    return this._counts(issueIds, "issue_node_refs");
  }

  referenceNodeIds(issueId: string): string[] {
    return (this._all("SELECT node_id FROM issue_node_refs WHERE issue_id = ? ORDER BY created_at, node_id", issueId) as unknown as Array<{ node_id: string }>).map((row) => row.node_id);
  }

  nextNumber(spaceId: string): number {
    const row = this._get("SELECT COALESCE(MAX(number), 0) + 1 AS next FROM issues WHERE space_id = ?", spaceId) as { next: number };
    return row.next;
  }

  insertIssue(input: {
    id: string;
    spaceId: string;
    number: number;
    title: string;
    body: string;
    authorUserId: string;
    now: number;
  }): void {
    this._run(
      `INSERT INTO issues (id, space_id, number, title, body, state, author_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      input.id, input.spaceId, input.number, input.title, input.body, input.authorUserId, input.now, input.now,
    );
  }

  updateIssueText(id: string, title: string, body: string, now: number): void {
    this._run("UPDATE issues SET title = ?, body = ?, updated_at = ? WHERE id = ?", title, body, now, id);
  }

  setIssueState(
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

  touch(id: string, now: number): void {
    this._run("UPDATE issues SET updated_at = ? WHERE id = ?", now, id);
  }

  addLabel(issueId: string, labelId: string): void {
    this._run("INSERT INTO issue_label_links (issue_id, label_id) VALUES (?, ?)", issueId, labelId);
  }

  removeLabel(issueId: string, labelId: string): void {
    this._run("DELETE FROM issue_label_links WHERE issue_id = ? AND label_id = ?", issueId, labelId);
  }

  addAssignee(issueId: string, userId: string): void {
    this._run("INSERT INTO issue_assignees (issue_id, user_id) VALUES (?, ?)", issueId, userId);
  }

  removeAssignee(issueId: string, userId: string): void {
    this._run("DELETE FROM issue_assignees WHERE issue_id = ? AND user_id = ?", issueId, userId);
  }

  addReference(issueId: string, nodeId: string, now: number): void {
    this._run("INSERT INTO issue_node_refs (issue_id, node_id, created_at) VALUES (?, ?, ?)", issueId, nodeId, now);
  }

  removeReference(issueId: string, nodeId: string): void {
    this._run("DELETE FROM issue_node_refs WHERE issue_id = ? AND node_id = ?", issueId, nodeId);
  }

  insertEvent(input: {
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

  insertComment(input: { id: string; issueId: string; authorUserId: string; body: string; now: number }): void {
    this._run(
      "INSERT INTO issue_comments (id, issue_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.id, input.issueId, input.authorUserId, input.body, input.now, input.now,
    );
  }

  findComment(id: string): CommentRow | null {
    return (this._get(
      `SELECT comment.*, issue.space_id AS space_id FROM issue_comments AS comment
       JOIN issues AS issue ON issue.id = comment.issue_id WHERE comment.id = ?`,
      id,
    ) as CommentRow | undefined) ?? null;
  }

  updateComment(id: string, body: string, now: number): void {
    this._run("UPDATE issue_comments SET body = ?, updated_at = ? WHERE id = ?", body, now, id);
  }

  deleteComment(id: string): void {
    this._run("DELETE FROM issue_comments WHERE id = ?", id);
  }

  timeline(issueId: string, cursor: TimelineCursor | null, limit: number): TimelineRow[] {
    const keyset = cursor ? "WHERE (created_at, rank, id) > (?, ?, ?)" : "";
    const params: SQLInputValue[] = [issueId, issueId];
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
       ) ${keyset} ORDER BY created_at, rank, id LIMIT ?`,
      ...params,
    ) as unknown as TimelineRow[];
  }

  listLabels(spaceId: string): Array<LabelRow & { open_issue_count: number }> {
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

  findLabel(id: string): LabelRow | null {
    return (this._get("SELECT * FROM issue_labels WHERE id = ?", id) as LabelRow | undefined) ?? null;
  }

  findLabelByName(spaceId: string, name: string): LabelRow | null {
    return (this._get("SELECT * FROM issue_labels WHERE space_id = ? AND name = ? COLLATE NOCASE", spaceId, name) as LabelRow | undefined) ?? null;
  }

  countLabels(spaceId: string): number {
    return (this._get("SELECT COUNT(*) AS count FROM issue_labels WHERE space_id = ?", spaceId) as { count: number }).count;
  }

  insertLabel(input: LabelRow & { now: number }): void {
    this._run(
      "INSERT INTO issue_labels (id, space_id, name, color, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      input.id, input.space_id, input.name, input.color, input.description, input.now, input.now,
    );
  }

  updateLabel(input: { id: string; name: string; color: string; description: string; now: number }): void {
    this._run(
      "UPDATE issue_labels SET name = ?, color = ?, description = ?, updated_at = ? WHERE id = ?",
      input.name, input.color, input.description, input.now, input.id,
    );
  }

  deleteLabel(id: string): void {
    this._run("DELETE FROM issue_labels WHERE id = ?", id);
  }

  isSpaceParticipant(spaceId: string, userId: string): boolean {
    return Boolean(this._get(
      `SELECT 1 FROM spaces WHERE id = ? AND type = 'team' AND (
         owner_user_id = ? OR EXISTS (SELECT 1 FROM space_members WHERE space_id = spaces.id AND user_id = ?))`,
      spaceId, userId, userId,
    ));
  }

  audience(spaceId: string): string[] {
    return (this._all(
      `SELECT owner_user_id AS user_id FROM spaces WHERE id = ?
       UNION SELECT user_id FROM space_members WHERE space_id = ? ORDER BY user_id`,
      spaceId, spaceId,
    ) as unknown as Array<{ user_id: string }>).map((row) => row.user_id);
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
  return { sql: clauses.join(" AND "), params };
}
