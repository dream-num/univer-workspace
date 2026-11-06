import type { components } from "../../../../../generated/http/schema.js";

export type DayKey = string & { readonly __day: unique symbol };
export interface DayWindow {
  readonly days: readonly DayKey[];
  readonly startIso: string;
}
export type ActorKind = "people" | "agents" | "unknown";
export interface ActorRef {
  readonly user: components["schemas"]["User"] | null;
  readonly kind: ActorKind;
}
export type SegmentKey = ActorKind;
export interface Segment {
  readonly key: SegmentKey;
  readonly value: number;
}
export interface SeriesDay {
  readonly day: DayKey;
  readonly segments: readonly Segment[];
  readonly total: number;
  readonly merged: number;
}
export interface DailySeries {
  readonly days: readonly SeriesDay[];
  readonly complete: boolean;
}
export interface PullRef {
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
  readonly spaceId: string | null;
}
export interface IssueRef {
  readonly number: number;
  readonly title: string;
  readonly spaceId: string;
}
export type ActivityEvent =
  | { readonly kind: "pull-opened" | "pull-merged"; readonly at: string; readonly actor: ActorRef; readonly pull: PullRef }
  | { readonly kind: "issue-opened" | "issue-closed"; readonly at: string; readonly actor: ActorRef; readonly issue: IssueRef };
export interface RepositoryActivity {
  readonly series: DailySeries;
  readonly events: readonly ActivityEvent[];
  readonly lastActivityAt: string | null;
  readonly complete: boolean;
}
export interface PendingChange {
  readonly pull: PullRef & { readonly state: "draft" | "ready" | "merging" };
  readonly kind: "modified" | "added" | "deleted";
  readonly unitName: string;
  readonly unitType: components["schemas"]["UnitType"];
  readonly scope: "self" | "inside";
  readonly actor: ActorRef;
}
export interface PendingChangeIndex {
  readonly byNode: ReadonlyMap<string, readonly PendingChange[]>;
  readonly additionsByParent: ReadonlyMap<string, readonly PendingChange[]>;
  readonly complete: boolean;
}
// Issue list responses expose only these repository identity fields.
export type RepositorySpace = Pick<components["schemas"]["SpaceSummary"], "id" | "name">;
export interface PullCardModel {
  readonly summary: string | null;
  readonly pull: PullRef & { readonly state: components["schemas"]["WorktreeState"] };
  readonly space: RepositorySpace | null;
  readonly actor: ActorRef;
  readonly canReview: boolean;
  readonly files: number;
  readonly updatedAt: string;
}
export interface IssueRowModel {
  readonly issue: IssueRef;
  readonly summary: components["schemas"]["IssueSummary"];
  readonly author: ActorRef;
}
export interface RepositoryLoad {
  readonly space: RepositorySpace;
  readonly segments: readonly Segment[];
  readonly total: number;
}
export type HomeHeadline =
  | { readonly kind: "agents-drafted"; readonly agents: number; readonly pulls: number }
  | { readonly kind: "open-work"; readonly pulls: number; readonly repositories: number }
  | { readonly kind: "quiet" };
export interface HomeWork {
  readonly headline: HomeHeadline;
  readonly ranking: readonly RepositoryLoad[];
  readonly updatedBySpace: ReadonlyMap<string, string>;
  readonly openBySpace: ReadonlyMap<string, { readonly pulls: number; readonly issues: number }>;
  readonly pulls: readonly PullCardModel[];
  readonly issues: readonly IssueRowModel[];
  readonly continueWorking: readonly components["schemas"]["RecentResourceItem"][];
  readonly complete: boolean;
}
export interface IssueFacets {
  readonly open: number;
  readonly assignedToMe: number;
  readonly createdByMe: number;
  readonly recentlyActive: number;
  readonly byLabel: ReadonlyMap<string, number>;
  readonly exact: boolean;
}
export type QueryView<T> =
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly error: unknown }
  | { readonly status: "success"; readonly data: T };

// Wire types remain private to this directory.
export type Worktree = components["schemas"]["WorktreeSummary"];
export type WorktreeDetail = components["schemas"]["WorktreeDetail"];
export type Issue = components["schemas"]["IssueSummary"];
export type RecentResource = components["schemas"]["RecentResourceItem"];
export type Space = Pick<components["schemas"]["SpaceView"], "id" | "type">;
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export type WireWriteSource = components["schemas"]["WriteSource"];
export type WireActivity = components["schemas"]["RepositoryActivity"];
