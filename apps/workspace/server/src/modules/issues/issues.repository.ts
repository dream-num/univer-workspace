import type { WriteSource } from "../identity/index.js";
import type { PublicUser } from "../permissions/index.js";
import type { IssueEventKind, IssueState, IssueStateReason } from "./issues.types.js";

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

export interface IssuesRepository {
  createIssue(input: CreateIssue): void;
  updateIssue(userId: string, spaceId: string, number: number, triage: boolean, patch: IssueUpdate, at: number): string;
  findIssue(spaceId: string, number: number): IssueRow | null;
  findIssueById(id: string): IssueRow | null;
  listIssues(filter: IssueFilter, page: IssueListPage): IssueRow[];
  activityRows(spaceId: string, since: number, limit: number): Array<Pick<IssueRow,
    "number" | "title" | "author_user_id" | "created_via" | "created_at" | "closed_by_user_id" | "closed_at"
  >>;
  countIssues(filter: IssueFilter): { open: number; closed: number };
  users(ids: readonly string[]): Map<string, PublicUser>;
  labelsFor(issueIds: readonly string[]): Map<string, Array<LabelRow & { issue_id: string }>>;
  assigneeIdsFor(issueIds: readonly string[]): Map<string, Array<{ issue_id: string; user_id: string }>>;
  commentCounts(issueIds: readonly string[]): Map<string, number>;
  referenceCounts(issueIds: readonly string[]): Map<string, number>;
  referenceNodeIds(issueId: string): string[];
  insertComment(input: { id: string; issueId: string; authorUserId: string; body: string; now: number }): void;
  findComment(id: string): CommentRow | null;
  updateComment(id: string, issueId: string, body: string, now: number): void;
  deleteComment(id: string, issueId: string, now: number): void;
  timeline(issueId: string, cursor: TimelineCursor | null, limit: number): TimelineRow[];
  listLabels(spaceId: string): Array<LabelRow & { open_issue_count: number }>;
  findLabel(id: string): LabelRow | null;
  insertLabel(input: LabelRow & { now: number }): void;
  updateLabel(input: LabelRow & { now: number }): void;
  deleteLabel(id: string): void;
  audience(spaceId: string): string[];
}
