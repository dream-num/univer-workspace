import type { OperationState } from "../resources/resources.types.js";

export type OperationDatabaseKind =
  | "create_resource"
  | "create_blob_resource"
  | "replace_blob_content"
  | "create_worktree"
  | "add_worktree_unit"
  | "create_worktree_unit"
  | "merge_worktree"
  | "discard_worktree"
  | "activate_worktree_resource"
  | "copy_node"
  | "revert_worktrees";

export interface OperationRow {
  readonly id: string;
  readonly kind: OperationDatabaseKind;
  readonly actor_user_id: string;
  readonly state: OperationState;
  readonly payload_json: string;
  readonly result_json: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface OperationsRepository {
  get(operationId: string, actorUserId: string): Promise<OperationRow | null>;
  retry(operationId: string, actorUserId: string, retriedAt: number): Promise<boolean>;
  fail(
    operationId: string,
    actorUserId: string,
    error: { readonly code: string; readonly message: string },
    failedAt: number
  ): Promise<void>;
}
