import type { WorkspaceDatabase } from "../../db/database.js";
import type { OperationState } from "../resources/resources.types.js";

export type OperationDatabaseKind =
  | "create_resource"
  | "create_blob_resource"
  | "create_worktree"
  | "add_worktree_unit"
  | "create_worktree_unit"
  | "merge_worktree"
  | "discard_worktree"
  | "activate_worktree_resource";

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

export class OperationsRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  get(operationId: string, actorUserId: string): OperationRow | null {
    return (
      (this._database.connection
        .prepare(
          "SELECT * FROM operations WHERE id = ? AND actor_user_id = ?"
        )
        .get(operationId, actorUserId) as OperationRow | undefined) ?? null
    );
  }

  retry(operationId: string, actorUserId: string, retriedAt: number): boolean {
    return (
      this._database.connection
        .prepare(
          `UPDATE operations
           SET state = 'pending',
               next_attempt_at = ?,
               last_error_code = NULL,
               last_error_message = NULL,
               lease_owner = 'product-api',
               lease_expires_at = ?,
               updated_at = ?
           WHERE id = ? AND actor_user_id = ? AND state = 'failed'`
        )
        .run(
          retriedAt,
          retriedAt + 60_000,
          retriedAt,
          operationId,
          actorUserId
        ).changes > 0
    );
  }

  fail(
    operationId: string,
    actorUserId: string,
    error: { readonly code: string; readonly message: string },
    failedAt: number
  ): void {
    this._database.connection
      .prepare(
        `UPDATE operations
         SET state = 'failed',
             last_error_code = ?,
             last_error_message = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ? AND actor_user_id = ? AND state = 'pending'`
      )
      .run(
        error.code,
        error.message,
        failedAt,
        operationId,
        actorUserId
      );
  }
}
