import type { DatabaseSync } from "node:sqlite";
import type { RevertError, RevertOperationRow, RevertsRepository } from "../../../modules/reverts/reverts.repository.js";
import type { RevertPayload } from "../../../modules/reverts/reverts.types.js";
import type { SqliteDatabase } from "../connection.js";

export class SqliteRevertsRepository implements RevertsRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  async find(operationId: string): Promise<RevertOperationRow | null> {
    return read(this._database.connection, operationId);
  }

  async reserve(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: RevertPayload;
    readonly runner: string;
    readonly createdAt: number;
    readonly leaseExpiresAt: number;
  }): Promise<{ readonly created: boolean; readonly row: RevertOperationRow }> {
    return this._database.transaction((database) => {
      const existing = read(database, input.operationId);
      if (existing) return { created: false, row: existing };
      database
        .prepare(
          `INSERT INTO operations
            (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, lease_owner, lease_expires_at, created_at, updated_at)
           VALUES (?, 'revert_worktrees', ?, 'reserved', 'pending', ?, 0, ?, ?, ?, ?, ?)`
        )
        .run(input.operationId, input.actorUserId, JSON.stringify(input.payload), input.createdAt, input.runner, input.leaseExpiresAt, input.createdAt, input.createdAt);
      return { created: true, row: read(database, input.operationId)! };
    });
  }

  async beginAttempt(operationId: string, runner: string, now: number, leaseExpiresAt: number): Promise<RevertOperationRow | null> {
    return (
      (this._database.connection
        .prepare(
          `UPDATE operations
           SET attempt_count = attempt_count + 1, lease_expires_at = ?, updated_at = ?
           WHERE id = ? AND kind = 'revert_worktrees' AND state = 'pending' AND lease_owner = ? RETURNING *`
        )
        .get(leaseExpiresAt, now, operationId, runner) as RevertOperationRow | undefined) ?? null
    );
  }

  async save(operationId: string, runner: string, payload: RevertPayload, now: number, leaseExpiresAt: number): Promise<boolean> {
    return this._database.connection
      .prepare(
        `UPDATE operations
         SET payload_json = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND kind = 'revert_worktrees' AND state = 'pending' AND lease_owner = ?`
      )
      .run(JSON.stringify(payload), leaseExpiresAt, now, operationId, runner).changes === 1;
  }

  async claimDue(workerId: string, now: number, leaseExpiresAt: number, limit: number): Promise<RevertOperationRow[]> {
    return this._database.transaction((database) => {
      const rows = database
        .prepare(
          `SELECT * FROM operations
           WHERE kind = 'revert_worktrees'
             AND state = 'pending'
             AND next_attempt_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY next_attempt_at, created_at LIMIT ?`
        )
        .all(now, now, limit) as unknown as RevertOperationRow[];
      const claim = database.prepare("UPDATE operations SET lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?");
      for (const row of rows) claim.run(workerId, leaseExpiresAt, now, row.id);
      return rows;
    });
  }

  async defer(input: {
    readonly operationId: string;
    readonly runner: string;
    readonly error: RevertError;
    readonly nextAttemptAt: number;
    readonly updatedAt: number;
  }): Promise<boolean> {
    return this._database.connection
      .prepare(
        `UPDATE operations
         SET last_error_code = ?, last_error_message = ?, next_attempt_at = ?,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND state = 'pending' AND lease_owner = ?`
      )
      .run(input.error.code, input.error.message, input.nextAttemptAt, input.updatedAt, input.operationId, input.runner).changes === 1;
  }

  async complete(input: {
    readonly operationId: string;
    readonly runner: string;
    readonly payload: RevertPayload;
    readonly result: Readonly<Record<string, unknown>>;
    readonly completedAt: number;
  }): Promise<boolean> {
    return this._database.connection
      .prepare(
        `UPDATE operations
         SET state = 'completed', step = 'completed', payload_json = ?, result_json = ?,
             last_error_code = NULL, last_error_message = NULL,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ?
         WHERE id = ? AND state = 'pending' AND lease_owner = ?`
      )
      .run(JSON.stringify(input.payload), JSON.stringify(input.result), input.completedAt, input.completedAt, input.operationId, input.runner).changes === 1;
  }

  async fail(input: {
    readonly operationId: string;
    readonly runner: string;
    readonly error: RevertError;
    readonly failedAt: number;
  }): Promise<boolean> {
    return this._database.connection
      .prepare(
        `UPDATE operations
         SET state = 'failed', last_error_code = ?, last_error_message = ?,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND state = 'pending' AND lease_owner = ?`
      )
      .run(input.error.code, input.error.message, input.failedAt, input.operationId, input.runner).changes === 1;
  }

  async retry(operationId: string, actorUserId: string, runner: string, now: number, leaseExpiresAt: number): Promise<boolean> {
    return this._database.connection
      .prepare(
        `UPDATE operations
         SET state = 'pending', attempt_count = 0, next_attempt_at = ?, last_error_code = NULL, last_error_message = NULL,
             lease_owner = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND kind = 'revert_worktrees' AND actor_user_id = ? AND state = 'failed'`
      )
      .run(now, runner, leaseExpiresAt, now, operationId, actorUserId).changes === 1;
  }
}

function read(database: DatabaseSync, operationId: string): RevertOperationRow | null {
  return (database.prepare("SELECT * FROM operations WHERE id = ?").get(operationId) as RevertOperationRow | undefined) ?? null;
}
