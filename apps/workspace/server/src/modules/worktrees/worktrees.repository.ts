import type { SpaceLanding, UnitType } from "../access/index.js";
import type { WriteSource } from "../identity/index.js";
import type { PublicUser } from "../permissions/index.js";
import type { OperationState } from "../resources/resources.types.js";
import type { IssueState } from "../issues/issues.types.js";
import type { WorktreeKind, WorktreeVisibility } from "./worktrees.types.js";

export interface WorktreeCursor {
  readonly timestamp: number;
  readonly id: string;
  readonly queryKey?: string;
}

export interface WorktreeRow {
  readonly created_via: WriteSource | null;
  readonly id: string;
  readonly name: string;
  readonly summary: string | null;
  readonly number: number | null;
  readonly creator_user_id: string;
  readonly kind: WorktreeKind;
  readonly team_space_id: string | null;
  readonly visibility: WorktreeVisibility;
  readonly processed_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly creator_username: string;
  readonly creator_display_name: string;
  readonly creator_avatar_url: string | null;
  readonly claimer_user_id: string | null;
  readonly claimer_username: string | null;
  readonly claimer_display_name: string | null;
  readonly claimer_avatar_url: string | null;
  readonly team_space_name: string | null;
  readonly team_owner_user_id: string | null;
  readonly team_landing: SpaceLanding | null;
  readonly issue_id: string | null;
  /** Null when no Issue is linked or the actor cannot read the Team Space. */
  readonly issue_number: number | null;
  readonly issue_title: string | null;
  readonly issue_state: IssueState | null;
  readonly actor_owns_team_space: 0 | 1 | null;
  readonly actor_member_role: "admin" | "editor" | "viewer" | null;
  readonly actor_proposes: 0 | 1 | null;
  readonly actor_owns_creator_space: 0 | 1;
  readonly unit_count: number;
  readonly pending_page_drafts: number;
}

export interface WorktreeUnitRow {
  readonly worktree_id: string;
  readonly unit_id: string;
  readonly resource_id: string;
  readonly node_id: string | null;
  readonly source: "trunk" | "worktree";
  readonly ordinal: number;
  readonly added_at: number;
  readonly existing_name: string | null;
  readonly existing_unit_type: UnitType | null;
  readonly target_space_id: string | null;
  readonly target_parent_node_id: string | null;
  readonly new_name: string | null;
  readonly new_unit_type: UnitType | null;
  readonly activated_at: number | null;
  readonly discarded_at: number | null;
}

export type WorktreeOperationDatabaseKind =
  | "create_worktree"
  | "add_worktree_unit"
  | "create_worktree_unit"
  | "merge_worktree"
  | "discard_worktree"
  | "activate_worktree_resource";

type OperationPayload = Readonly<Record<string, unknown>> & { readonly worktreeId: string };

export type WorktreeReservation = {
  readonly id: string;
  readonly actorUserId: string;
  readonly createdAt: number;
} & (
  | { readonly kind: "create_worktree_unit"; readonly payload: OperationPayload & {
      readonly targetSpaceId: string; readonly targetParentNodeId: string | null;
    } }
  | { readonly kind: "add_worktree_unit"; readonly payload: OperationPayload & { readonly resourceId: string } }
  | { readonly kind: "create_worktree"; readonly payload: OperationPayload & { readonly teamSpaceId: string | null } }
  | { readonly kind: "merge_worktree" | "discard_worktree"; readonly payload: OperationPayload }
);

export interface WorktreeOperationRow {
  readonly id: string;
  readonly kind: WorktreeOperationDatabaseKind;
  readonly actor_user_id: string;
  readonly state: OperationState;
  readonly step: string;
  readonly payload_json: string;
  readonly result_json: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface WorktreeCheckRow {
  readonly content_key: string;
  readonly name: string;
  readonly reporter_user_id: string;
  readonly reporter_username: string;
  readonly reporter_display_name: string;
  readonly reporter_avatar_url: string | null;
  readonly state: "passed" | "failed";
  readonly summary: string;
  readonly reported_at: number;
}

export interface WorktreesRepository {
  hasCreatedWorktree(userId: string): Promise<boolean>;
  audience(worktreeId: string): Promise<string[]>;
  /** Includes a processed private Team Worktree for every member, since a merge shares it; the service drops the discarded ones. */
  listCandidates(input: {
    readonly userId: string;
    readonly scope: "active" | "processed" | "all";
    readonly touchedSince?: number;
    readonly search: string;
    readonly order: "updatedAtDesc" | "createdAtDesc";
    readonly kind: WorktreeKind | null;
    readonly teamSpaceId: string | null;
    readonly creatorUserId?: string;
    readonly issueId?: string;
    readonly cursor: WorktreeCursor | null;
    readonly limit: number;
  }): Promise<WorktreeRow[]>;
  get(worktreeId: string, userId: string): Promise<WorktreeRow | null>;
  resourceUnit(resourceId: string): Promise<{
    readonly unitId: string;
    readonly unitType: UnitType;
  } | null>;
  create(input: {
    readonly id: string;
    readonly name: string;
    readonly summary: string | null;
    readonly creatorUserId: string;
    readonly kind: WorktreeKind;
    readonly teamSpaceId: string | null;
    readonly visibility: WorktreeVisibility;
    readonly createdVia: WriteSource | null;
    readonly createdAt: number;
    readonly forkId: string | null;
    readonly issueId: string | null;
  }): Promise<void>;
  findIdByNumber(
    scope: { readonly teamSpaceId: string } | { readonly creatorUserId: string },
    number: number
  ): Promise<string | null>;
  /** Apply only the supplied fields while the actor can manage the summary. */
  update(input: {
    readonly id: string;
    readonly actorId: string;
    readonly name?: string;
    readonly summary?: string | null;
    readonly visibility?: WorktreeVisibility;
    readonly issueId?: string | null;
    readonly updatedAt: number;
  }): Promise<boolean>;
  findIssueId(teamSpaceId: string, number: number): Promise<string | null>;
  units(worktreeId: string): Promise<WorktreeUnitRow[]>;
  addTrunkUnit(input: {
    readonly worktreeId: string;
    readonly unitId: string;
    readonly resourceId: string;
    readonly addedAt: number;
  }): Promise<void>;
  /** Publish the local file intent and complete its creation operation atomically. */
  completeLocalUnit(input: {
    readonly operationId: string;
    readonly worktreeId: string;
    readonly unitId: string;
    readonly resourceId: string;
    readonly nodeId: string;
    readonly targetSpaceId: string;
    readonly targetParentNodeId: string | null;
    readonly name: string;
    readonly unitType: UnitType;
    readonly createdBy: string;
    readonly createdAt: number;
  }): Promise<void>;
  activateLocalUnit(
    row: WorktreeUnitRow,
    actorUserId: string,
    creatorUserId: string,
    activatedAt: number
  ): Promise<void>;
  markProcessed(worktreeId: string, processedAt: number): Promise<void>;
  markLocalUnitsDiscarded(worktreeId: string, discardedAt: number): Promise<void>;
  markLocalUnitDiscarded(worktreeId: string, unitId: string, discardedAt: number): Promise<void>;
  removalBatchId(worktreeId: string, unitId: string): Promise<string>;
  hasRemovalReceipt(worktreeId: string, unitId: string, userId: string): Promise<boolean>;
  mergers(worktreeIds: readonly string[]): Promise<ReadonlyMap<string, PublicUser>>;
  /** Every check result on the Worktree, newest first. */
  checks(worktreeId: string): Promise<WorktreeCheckRow[]>;
  /** Records one reporter's result on one check for one content, replacing that reporter's earlier result on it. */
  reportCheck(input: {
    readonly worktreeId: string;
    readonly contentKey: string;
    readonly name: string;
    readonly reporterUserId: string;
    readonly state: "passed" | "failed";
    readonly summary: string;
    readonly reportedAt: number;
  }): Promise<void>;
  /** The content key the latest merge recorded when it left ready. */
  mergedContentKey(worktreeId: string): Promise<string | null>;
  getOperation(operationId: string): Promise<WorktreeOperationRow | null>;
  reserveOperation(input: WorktreeReservation): Promise<{ readonly created: boolean; readonly row: WorktreeOperationRow }>;
  completeOperation(
    operationId: string,
    result: Readonly<Record<string, unknown>>,
    completedAt: number
  ): Promise<WorktreeOperationRow>;
  /** Puts a failed Operation back to pending before it runs again, as a retry does, counting the place it takes. */
  retryOperation(operationId: string, actorUserId: string, retriedAt: number): Promise<void>;
  failOperation(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    failedAt: number
  ): Promise<void>;
}
