import type {
  WorktreeData,
  WorktreeUnitMergeResult,
} from "@univerjs-pro/collaboration-worktree-service";
import type { IChangeset, UniverType } from "@univerjs/protocol";
import type { UnitType } from "../access/index.js";
import type { PublishedPage } from "../html-view-drafts/drafts.types.js";
import type { OperationState } from "../resources/resources.types.js";
import type { PublicUser } from "../permissions/index.js";
import type { WriteSource, WriteSourceView } from "../identity/index.js";
import type { IssuePullRequestView, IssueState } from "../issues/issues.types.js";

export type WorktreeKind = "user" | "team";
export type WorktreeVisibility = "private" | "space";
export type WorktreeState = WorktreeData["status"];

export interface WorktreeCapabilities {
  readonly review: boolean;
  readonly editDraft: boolean;
  readonly addUnit: boolean;
  readonly changeVisibility: boolean;
  readonly markReady: boolean;
  readonly reopen: boolean;
  readonly merge: boolean;
  readonly discard: boolean;
}

export interface WorktreeSummary {
  readonly createdVia: WriteSourceView;
  readonly id: string;
  readonly number: number | null;
  readonly name: string;
  readonly summary: string | null;
  readonly kind: WorktreeKind;
  readonly teamSpace: {
    readonly id: string;
    readonly type: "team";
    readonly name: string;
  } | null;
  readonly visibility: WorktreeVisibility;
  readonly state: WorktreeState;
  readonly creator: PublicUser;
  readonly claimer: PublicUser | null;
  readonly unitCount: number;
  readonly pendingPageDrafts: number;
  readonly processedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly capabilities: WorktreeCapabilities;
  /** The Issue this pull request serves. Null when none is linked or the caller cannot read its Team Space. */
  readonly issue: {
    readonly number: number;
    readonly title: string;
    readonly state: IssueState;
  } | null;
}

export type MergeResult =
  | "pending"
  | WorktreeUnitMergeResult["status"];

export type WorktreeUnitChange =
  | "modified"
  | "added"
  | "deleted"
  | "unchanged";

export type ActivationState =
  | "notApplicable"
  | "waitingForMerge"
  | "pending"
  | "completed"
  | "failed"
  | "discarded";

export interface WorktreeUnit {
  readonly unitId: string;
  readonly resourceId: string;
  readonly nodeId: string | null;
  readonly source: "trunk" | "worktree";
  readonly name: string;
  readonly unitType: UnitType;
  readonly target: {
    readonly spaceId: string;
    readonly parentNodeId: string | null;
  } | null;
  readonly draftHeadRevision: number;
  readonly change: WorktreeUnitChange;
  readonly mergeResult: MergeResult;
  readonly activationState: ActivationState;
  readonly freshness: WorktreeUnitFreshness | null;
  readonly fileState: WorktreeUnitFileState | null;
}

export type WorktreeUnitFileState = "live" | "inTrash" | "deleted";

export interface WorktreeUnitFreshness {
  readonly label: "current" | "behind" | "stale";
  readonly baselineTrunkRevision: number;
  readonly revisionsBehind: number;
  readonly addedAt: string;
}

export interface WorktreeDetail extends WorktreeSummary {
  readonly units: readonly WorktreeUnit[];
  /** How many declared checks pass, fail or lack a counting result; null when the reader cannot review. */
  readonly checks?: WorktreeChecksSummary | null;
}

export type WorktreeCheckReportState = "passed" | "failed";

export interface WorktreeCheckResult {
  readonly reporter: PublicUser;
  readonly state: WorktreeCheckReportState;
  readonly summary: string;
  readonly reportedAt: string;
  /** Reported on the content the pull request has now, or merged with. */
  readonly current: boolean;
  /** Current, and reported by someone who may merge the pull request. */
  readonly counts: boolean;
}

export interface WorktreeCheck {
  readonly name: string;
  readonly declared: boolean;
  readonly state: WorktreeCheckReportState | "missing";
  readonly results: readonly WorktreeCheckResult[];
}

export interface WorktreeChecksSummary {
  readonly passed: number;
  readonly failed: number;
  readonly missing: number;
}

export type WorktreeOperationKind =
  | "createWorktree"
  | "addWorktreeUnit"
  | "createWorktreeUnit"
  | "mergeWorktree"
  | "discardWorktree"
  | "activateWorktreeResource";

export interface WorktreeOperationView {
  readonly id: string;
  readonly kind: WorktreeOperationKind;
  readonly state: OperationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: {
    readonly code: string;
    readonly message: string;
  } | null;
}

export interface WorktreeProductChange {
  readonly kind:
    | "created"
    | "updated"
    | "unitAdded"
    | "contentChanged"
    | "stateChanged"
    | "merged"
    | "discarded";
  readonly worktreeId: string;
  readonly audienceUserIds: readonly string[];
}

export interface WorktreeBackend {
  createWorktree(
    worktreeId: string,
    userId: string
  ): Promise<WorktreeData>;
  getWorktree(worktreeId: string, userId: string): Promise<WorktreeData>;
  addUnit(
    worktreeId: string,
    unitId: string,
    userId: string
  ): Promise<WorktreeData>;
  createUnit(
    input: {
      readonly worktreeId: string;
      readonly unitId: string;
      readonly unitType: UnitType;
      readonly name: string;
      readonly initialData?: Readonly<Record<string, unknown>>;
    },
    userId: string
  ): Promise<WorktreeData>;
  markReady(worktreeId: string, userId: string): Promise<WorktreeData>;
  setUnitRemoved(
    worktreeId: string,
    unitId: string,
    removed: boolean,
    userId: string,
  ): Promise<WorktreeData>;
  reopen(worktreeId: string, userId: string): Promise<WorktreeData>;
  /** `checkedDraft` is the `draftKey` the checks gate decided on; the merge starts only while the draft still matches it. */
  merge(worktreeId: string, userId: string, checkedDraft?: string): Promise<WorktreeData>;
  discard(worktreeId: string, userId: string): Promise<WorktreeData>;
  submitChangeset(
    worktreeId: string,
    changeset: IChangeset,
    userId: string
  ): Promise<WorktreeChangesetSubmitResult>;
  /** Null when Trunk has no such Unit. */
  trunkRevision(unitId: string, userId: string): Promise<number | null>;
  /** Trunk changesets after revision `after` through `to`, oldest first. */
  trunkChangesets(unitId: string, type: UniverType, after: number, to: number, userId: string): Promise<readonly TrunkChangeset[]>;
  /** Submits on Trunk a changeset that only restores the Unit to `targetRevision`. It commits only while `baseRev` is head. */
  restoreTrunk(
    input: {
      readonly unitId: string;
      readonly type: UniverType;
      readonly baseRev: number;
      readonly targetRevision: number;
      readonly sid: string;
      readonly reqId: number;
    },
    userId: string,
  ): Promise<WorktreeChangesetSubmitResult>;
}

export interface TrunkChangeset {
  readonly revision: number;
  readonly userId: string;
  readonly sid: string;
  readonly createdAt: number | null;
}

/** What a pull request's merge did to Trunk, from the Collaboration Service's record of it. */
export interface MergedChanges {
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
  readonly teamSpaceId: string | null;
  /** Trunk moved and the product finished recording the merge. */
  readonly merged: boolean;
  /** The actor may merge this pull request, setting aside their access to its Units and pages. */
  readonly decides: boolean;
  readonly units: readonly MergedUnit[];
}

export interface MergedUnit {
  readonly unitId: string;
  readonly nodeId: string | null;
  readonly resourceId: string;
  readonly name: string;
  readonly unitType: UnitType;
  readonly univerType: UniverType;
  /** The reader cannot see this file's name, nor whether it is live, in Trash or deleted. */
  readonly hidden: boolean;
  /** modified: the merge wrote `trunkRevision`. added: the merge created the file. removed: it went to Trash in `removalBatchId`. */
  readonly change:
    | { readonly kind: "modified"; readonly trunkRevision: number }
    | { readonly kind: "added" }
    | { readonly kind: "removed"; readonly removalBatchId: string };
}

export type WorktreeChangesetSubmitResult =
  | {
      readonly status: "committed" | "already-committed";
      readonly changeset: IChangeset;
    }
  | {
      readonly status: "rejected" | "retry";
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
        readonly details?: Readonly<Record<string, unknown>>;
      };
    };

export interface WorktreeActivity {
  readonly id: string;
  readonly number: number | null;
  readonly name: string;
  readonly creator: PublicUser;
  readonly createdVia: WriteSource | null;
  readonly createdAt: number;
  readonly mergedAt: number | null;
  readonly mergedBy: PublicUser | null;
}

export type WorktreeActivityScope =
  | { readonly kind: "team"; readonly teamSpaceId: string }
  | { readonly kind: "user"; readonly creatorUserId: string };

export interface WorktreesModule {
  activity(userId: string, scope: WorktreeActivityScope, since: number): Promise<{
    readonly items: readonly WorktreeActivity[];
    readonly complete: boolean;
  }>;
  setUnitRemoved(
    userId: string,
    worktreeId: string,
    unitId: string,
    input: unknown,
  ): Promise<{ readonly worktree: WorktreeDetail }>;
  list(
    userId: string,
    query: {
      readonly scope: unknown;
      readonly search?: unknown;
      readonly order?: unknown;
      readonly kind: unknown;
      readonly teamSpaceId: unknown;
      readonly state?: unknown;
      readonly cursor: unknown;
      readonly limit: unknown;
    }
  ): Promise<{
    readonly items: readonly WorktreeSummary[];
    readonly hasCreatedWorktree: boolean;
    readonly nextCursor: string | null;
  }>;
  create(
    userId: string,
    operationId: unknown,
    input: unknown,
    createdVia?: WriteSource | null,
    forkId?: string | null
  ): Promise<{ readonly status: 201; readonly body: WorktreeSummary }>;
  /** The pull requests linked to an Issue that the User may see, newest first. */
  pullRequestsForIssue(userId: string, issueId: string): Promise<readonly IssuePullRequestView[]>;
  /** What the pull request's merge changed on Trunk, for a revert. */
  mergedChanges(userId: string, worktreeId: string): Promise<MergedChanges>;
  get(
    userId: string,
    worktreeId: string,
    withChecks?: boolean
  ): Promise<{ readonly worktree: WorktreeDetail }>;
  /** Every declared check, then every other reported name, with all their results. */
  checks(userId: string, worktreeId: string): Promise<{ readonly checks: readonly WorktreeCheck[] }>;
  reportCheck(
    userId: string,
    worktreeId: string,
    name: string,
    input: unknown
  ): Promise<{ readonly check: WorktreeCheck }>;
  getByNumber(
    userId: string,
    spaceId: string,
    number: unknown
  ): Promise<{ readonly worktree: WorktreeDetail }>;
  update(
    userId: string,
    worktreeId: string,
    input: unknown
  ): Promise<{ readonly worktree: WorktreeDetail }>;
  addUnit(
    userId: string,
    worktreeId: string,
    operationId: unknown,
    input: unknown
  ): Promise<{ readonly status: 201; readonly body: { readonly unit: WorktreeUnit } }>;
  /** Throws unless the User may create a file in this pull request that lands at the target. */
  assertCanCreateUnit(
    userId: string,
    worktreeId: string,
    targetSpaceId: string,
    targetParentNodeId: string | null
  ): Promise<void>;
  openUnit(
    userId: string,
    worktreeId: string,
    unitId: string,
    input: unknown
  ): Promise<{
    readonly unit: {
      readonly unitId: string;
      readonly unitType: UnitType;
      readonly editorMode: "edit" | "readOnly";
    };
    readonly collaborationScope:
      | { readonly kind: "trunk" }
      | {
          readonly kind: "worktree" | "mergePreview";
          readonly worktreeId: string;
    };
  }>;
  submitChangeset(
    userId: string,
    worktreeId: string,
    unitId: string,
    input: unknown
  ): Promise<WorktreeChangesetSubmitResult>;
  markReady(
    userId: string,
    worktreeId: string
  ): Promise<{ readonly worktree: WorktreeSummary }>;
  reopen(
    userId: string,
    worktreeId: string
  ): Promise<{ readonly worktree: WorktreeSummary }>;
  merge(
    userId: string,
    worktreeId: string,
    operationId: unknown,
    /** A person merging in the browser, not a CLI, PAT or OAuth session. */
    browser?: boolean,
    /** The request body, which may name the pending page drafts the merger reviewed. */
    input?: unknown
  ): Promise<{
    readonly publishedPages: readonly PublishedPage[];
    readonly operation: WorktreeOperationView;
    readonly worktree: WorktreeSummary;
  }>;
  discard(
    userId: string,
    worktreeId: string,
    operationId: unknown
  ): Promise<{
    readonly operation: WorktreeOperationView;
    readonly worktree: WorktreeSummary;
  }>;
  authorizeProtocol(input: {
    readonly userId: string;
    readonly worktreeId: string;
    readonly unitId?: string;
    readonly write: boolean;
  }): Promise<boolean>;
}
