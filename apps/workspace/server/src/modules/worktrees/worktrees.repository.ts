import type { UnitType } from "../access/index.js";
import type { WriteSource } from "../identity/index.js";
import type { OperationState } from "../resources/resources.types.js";
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
  readonly team_space_name: string | null;
  readonly team_owner_user_id: string | null;
  readonly actor_member_role: "admin" | "editor" | "viewer" | null;
  readonly unit_count: number;
}

export interface WorktreeUnitRow {
  readonly worktree_id: string;
  readonly unit_id: string;
  readonly resource_id: string;
  readonly node_id: string | null;
  readonly source: "trunk" | "worktree";
  readonly ordinal: number;
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

export interface WorktreesRepository {
  hasCreatedWorktree(userId: string): Promise<boolean>;
  audience(worktreeId: string): Promise<string[]>;
  listCandidates(input: {
    readonly userId: string;
    readonly scope: "active" | "processed" | "all";
    readonly touchedSince?: number;
    readonly search: string;
    readonly order: "updatedAtDesc" | "createdAtDesc";
    readonly kind: WorktreeKind | null;
    readonly teamSpaceId: string | null;
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
    readonly updatedAt: number;
  }): Promise<boolean>;
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
    creatorUserId: string,
    activatedAt: number
  ): Promise<void>;
  markProcessed(worktreeId: string, processedAt: number): Promise<void>;
  markLocalUnitsDiscarded(worktreeId: string, discardedAt: number): Promise<void>;
  markLocalUnitDiscarded(worktreeId: string, unitId: string, discardedAt: number): Promise<void>;
  removalBatchId(worktreeId: string, unitId: string): Promise<string>;
  hasRemovalReceipt(worktreeId: string, unitId: string, userId: string): Promise<boolean>;
  getOperation(operationId: string): Promise<WorktreeOperationRow | null>;
  reserveOperation(input: {
    readonly id: string;
    readonly kind: WorktreeOperationDatabaseKind;
    readonly actorUserId: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly createdAt: number;
  }): Promise<{ readonly created: boolean; readonly row: WorktreeOperationRow }>;
  completeOperation(
    operationId: string,
    result: Readonly<Record<string, unknown>>,
    completedAt: number
  ): Promise<WorktreeOperationRow>;
  failOperation(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    failedAt: number
  ): Promise<void>;
}
