import { assertFileQuota } from "../access/access.repository.js";
import type { SqliteDatabase } from "../connection.js";
import type { OperationRow, OperationsRepository } from "../../../modules/operations/operations.repository.js";

export class SqliteOperationsRepository implements OperationsRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  async get(operationId: string, actorUserId: string): Promise<OperationRow | null> {
    return (
      (this._database.connection
        .prepare(
          "SELECT * FROM operations WHERE id = ? AND actor_user_id = ?"
        )
        .get(operationId, actorUserId) as OperationRow | undefined) ?? null
    );
  }

  async retry(operationId: string, actorUserId: string, retriedAt: number): Promise<boolean> {
    return this._database.transaction((db) => {
      const row = db
        .prepare(
          `UPDATE operations
           SET state = 'pending',
               next_attempt_at = ?,
               last_error_code = NULL,
               last_error_message = NULL,
               lease_owner = 'product-api',
               lease_expires_at = ?,
               updated_at = ?
           WHERE id = ? AND actor_user_id = ? AND state = 'failed' RETURNING kind`
        )
        .get(
          retriedAt,
          retriedAt + 60_000,
          retriedAt,
          operationId,
          actorUserId
        );
      if (row?.kind === "create_worktree_unit") assertFileQuota(db, actorUserId, 0);
      return Boolean(row);
    });
  }

  async fail(
    operationId: string,
    actorUserId: string,
    error: { readonly code: string; readonly message: string },
    failedAt: number
  ): Promise<void> {
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
