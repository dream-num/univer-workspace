import type { NodeAccess, SpaceAccess } from "../access/index.js";
import type { WriteSource } from "../identity/index.js";
import type { PublicUser } from "../permissions/index.js";
import type { IssueEventKind, IssueState, IssueStateReason, IssueVerdictKind } from "./issues.types.js";

export interface IssueRow {
  readonly created_via: WriteSource | null;
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

export interface VerdictRow {
  readonly id: string;
  readonly kind: IssueVerdictKind;
  readonly actor_user_id: string | null;
  readonly body: string;
  readonly created_at: number;
}

export interface TimelineRow {
  readonly type: "comment" | "event" | "verdict";
  readonly id: string;
  /** Null only for a verdict its acceptance deadline recorded. */
  readonly actor_user_id: string | null;
  readonly body: string | null;
  readonly kind: IssueEventKind | IssueVerdictKind | null;
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
  readonly acceptance: "submitted" | "sent_back" | null;
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

export interface IssueRelations {
  readonly labelIds?: readonly string[];
  readonly assigneeUserIds?: readonly string[];
  readonly nodeIds?: readonly string[];
}

export interface IssueUpdate extends IssueRelations {
  readonly title?: string;
  readonly body?: string;
  readonly state?: IssueState;
  readonly stateReason: IssueStateReason | null;
}

export interface CreateIssue {
  readonly id: string;
  readonly spaceId: string;
  readonly userId: string;
  readonly createdVia: WriteSource | null;
  readonly title: string;
  readonly body: string;
  readonly relations: IssueRelations;
  readonly now: number;
}

export interface IssueSummaryData {
  readonly labels: ReadonlyMap<string, readonly LabelRow[]>;
  readonly assignees: ReadonlyMap<string, ReadonlyArray<{ user_id: string }>>;
  readonly commentCounts: ReadonlyMap<string, number>;
  readonly referenceCounts: ReadonlyMap<string, number>;
  readonly users: ReadonlyMap<string, PublicUser>;
}

/** A write returns the issue, relations and actor access as of its commit. */
export interface IssueDetail {
  readonly row: IssueRow;
  readonly space: SpaceAccess;
  readonly summary: IssueSummaryData;
  readonly references: ReadonlyArray<{ nodeId: string; node: NodeAccess | null }>;
  readonly acceptance: VerdictRow | null;
  /** When the Space's deadline accepts this submitted Issue; null when nothing will. */
  readonly acceptAt: number | null;
}

export interface DueIssue {
  readonly id: string;
}

export interface RecordVerdict {
  readonly id: string;
  readonly userId: string;
  readonly spaceId: string;
  readonly number: number;
  readonly kind: IssueVerdictKind;
  readonly body: string;
  readonly now: number;
}

export type LabelFields = Pick<LabelRow, "name" | "color" | "description">;

/** A current assignee and the time of its latest `assigned` event. */
export interface AssignmentRow {
  readonly user_id: string;
  readonly assigned_at: number;
}

export interface IssuesRepository {
  createIssue(input: CreateIssue): Promise<IssueDetail>;
  updateIssue(userId: string, spaceId: string, number: number, patch: IssueUpdate, at: number): Promise<IssueDetail>;
  recordVerdict(input: RecordVerdict): Promise<IssueDetail>;
  /** Up to `limit` submitted Issues whose acceptance deadline passed by `now`, in random order. */
  listDueIssues(now: number, limit: number): Promise<DueIssue[]>;
  /** Accepts the Issue by deadline in one transaction if it is still due at `now`, and returns its Space ID. */
  acceptDueIssue(issueId: string, now: number): Promise<string | null>;
  findIssue(spaceId: string, number: number): Promise<IssueRow | null>;
  issueDetail(userId: string, spaceId: string, number: number): Promise<IssueDetail>;
  listIssues(filter: IssueFilter, page: IssueListPage): Promise<IssueRow[]>;
  activityRows(spaceId: string, since: number, limit: number): Promise<Array<Pick<IssueRow,
    "number" | "title" | "author_user_id" | "created_via" | "created_at" | "closed_by_user_id" | "closed_at"
  >>>;
  countIssues(filter: IssueFilter): Promise<{ open: number; closed: number }>;
  users(ids: readonly string[]): Promise<Map<string, PublicUser>>;
  summaryData(rows: readonly IssueRow[]): Promise<IssueSummaryData>;
  insertComment(input: { id: string; issueId: string; authorUserId: string; body: string; now: number }): Promise<CommentRow>;
  findComment(id: string): Promise<CommentRow | null>;
  updateComment(userId: string, id: string, body: string, now: number): Promise<CommentRow>;
  deleteComment(userId: string, id: string, now: number): Promise<string>;
  timeline(issueId: string, cursor: TimelineCursor | null, limit: number): Promise<TimelineRow[]>;
  assignments(issueId: string): Promise<AssignmentRow[]>;
  listLabels(spaceId: string): Promise<Array<LabelRow & { open_issue_count: number }>>;
  findLabel(id: string): Promise<LabelRow | null>;
  insertLabel(userId: string, input: LabelRow & { now: number }): Promise<void>;
  updateLabel(userId: string, id: string, patch: Partial<LabelFields>, now: number): Promise<LabelRow>;
  deleteLabel(userId: string, id: string): Promise<string>;
  audience(spaceId: string): Promise<string[]>;
}
