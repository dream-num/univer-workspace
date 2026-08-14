import type {
  WorktreeData,
  WorktreeUnitMergeResult,
} from "@univerjs-pro/collaboration-worktree-service";
import type { IChangeset } from "@univerjs/protocol";
import type { UnitType } from "../access/index.js";
import type { OperationState } from "../resources/resources.types.js";
import type { PublicUser } from "../permissions/index.js";

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
  readonly id: string;
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
  readonly unitCount: number;
  readonly processedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly capabilities: WorktreeCapabilities;
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
  readonly nodeId: string;
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
}

export interface WorktreeDetail extends WorktreeSummary {
  readonly units: readonly WorktreeUnit[];
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
  reopen(worktreeId: string, userId: string): Promise<WorktreeData>;
  merge(worktreeId: string, userId: string): Promise<WorktreeData>;
  discard(worktreeId: string, userId: string): Promise<WorktreeData>;
  submitChangeset(
    worktreeId: string,
    changeset: IChangeset,
    userId: string
  ): Promise<WorktreeChangesetSubmitResult>;
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

export interface WorktreesModule {
  list(
    userId: string,
    query: {
      readonly scope: unknown;
      readonly kind: unknown;
      readonly teamSpaceId: unknown;
      readonly cursor: unknown;
      readonly limit: unknown;
    }
  ): Promise<{
    readonly items: readonly WorktreeSummary[];
    readonly nextCursor: string | null;
  }>;
  create(
    userId: string,
    operationId: unknown,
    input: unknown
  ): Promise<{ readonly status: 201; readonly body: WorktreeSummary }>;
  get(
    userId: string,
    worktreeId: string
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
    operationId: unknown
  ): Promise<{
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
