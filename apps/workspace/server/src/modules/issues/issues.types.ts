import type { PublicUser } from "../permissions/index.js";

export type IssueState = "open" | "closed";
export type IssueStateReason = "completed" | "not_planned";

/** Palette keys; the Browser owns the light and dark values of each key. */
export const ISSUE_LABEL_COLORS = [
  "gray",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "pink",
] as const;
export type IssueLabelColor = (typeof ISSUE_LABEL_COLORS)[number];

export interface IssueLabelView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface IssueLabelUsageView extends IssueLabelView {
  readonly openIssueCount: number;
}

export interface IssueReferenceView {
  readonly nodeId: string;
  /** False when the Node is in Trash, deleted or no longer readable. */
  readonly available: boolean;
  readonly name: string | null;
  readonly resource:
    | {
        readonly id: string;
        readonly kind: "univer";
        readonly unitId: string;
        readonly unitType: string;
      }
    | {
        readonly id: string;
        readonly kind: "blob";
        readonly mediaType: string;
      }
    | null;
}

export interface IssueSummaryView {
  readonly id: string;
  readonly number: number;
  readonly space: { readonly id: string; readonly name: string };
  readonly title: string;
  readonly state: IssueState;
  readonly stateReason: IssueStateReason | null;
  readonly author: PublicUser;
  readonly closedBy: PublicUser | null;
  readonly closedAt: string | null;
  readonly labels: readonly IssueLabelView[];
  readonly assignees: readonly PublicUser[];
  readonly commentCount: number;
  readonly referenceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueCapabilitiesView {
  readonly edit: boolean;
  readonly close: boolean;
  readonly triage: boolean;
  readonly comment: boolean;
}

export interface IssueView extends IssueSummaryView {
  readonly body: string;
  readonly references: readonly IssueReferenceView[];
  readonly capabilities: IssueCapabilitiesView;
}

export interface IssueList {
  readonly items: readonly IssueSummaryView[];
  readonly nextCursor: string | null;
  readonly counts: { readonly open: number; readonly closed: number };
}

export type IssueEventKind =
  | "closed"
  | "reopened"
  | "renamed"
  | "labeled"
  | "unlabeled"
  | "assigned"
  | "unassigned"
  | "node_referenced"
  | "node_unreferenced";

export type IssueTimelineItem =
  | {
      readonly type: "comment";
      readonly id: string;
      readonly author: PublicUser;
      readonly body: string;
      readonly createdAt: string;
      readonly updatedAt: string;
    }
  | {
      readonly type: "event";
      readonly id: string;
      readonly kind: IssueEventKind;
      readonly actor: PublicUser;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly createdAt: string;
    };

export interface IssueTimelinePage {
  readonly items: readonly IssueTimelineItem[];
  readonly nextCursor: string | null;
}

export interface IssueCommentView {
  readonly id: string;
  readonly author: PublicUser;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueProductChange {
  readonly spaceId: string;
  readonly audienceUserIds: readonly string[];
}

export interface IssueListQuery {
  readonly state?: unknown;
  readonly label?: unknown;
  readonly assignee?: unknown;
  readonly author?: unknown;
  readonly q?: unknown;
  readonly sort?: unknown;
  readonly order?: unknown;
  readonly cursor?: unknown;
  readonly limit?: unknown;
}

export interface IssuesModule {
  list(userId: string, spaceId: string, query: IssueListQuery): IssueList;
  listMine(userId: string, query: IssueListQuery): IssueList;
  create(userId: string, spaceId: string, input: unknown): IssueView;
  get(userId: string, spaceId: string, number: unknown): IssueView;
  update(userId: string, spaceId: string, number: unknown, input: unknown): IssueView;
  timeline(
    userId: string,
    spaceId: string,
    number: unknown,
    page: { readonly cursor?: unknown; readonly limit?: unknown },
  ): IssueTimelinePage;
  createComment(userId: string, spaceId: string, number: unknown, input: unknown): IssueCommentView;
  updateComment(userId: string, commentId: string, input: unknown): IssueCommentView;
  deleteComment(userId: string, commentId: string): void;
  listLabels(userId: string, spaceId: string): { readonly labels: readonly IssueLabelUsageView[] };
  createLabel(userId: string, spaceId: string, input: unknown): IssueLabelView;
  updateLabel(userId: string, labelId: string, input: unknown): IssueLabelView;
  deleteLabel(userId: string, labelId: string): void;
}
