import { assertFileQuota } from "../access/access.repository.js";
import type { SqliteDatabase } from "../connection.js";
import type { CreateResourcePayload } from "../../../modules/resources/resources.types.js";
import type { OperationRow, ReservedCreateResource, ResourcesRepository } from "../../../modules/resources/resources.repository.js";

export class SqliteResourcesRepository implements ResourcesRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  async reserveCreateResource(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CreateResourcePayload;
    readonly createdAt: number;
  }): Promise<ReservedCreateResource> {
    return this._database.transaction((database) => {
      assertFileQuota(database, input.actorUserId, 1, input.operationId);
      const existing = database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(input.operationId) as OperationRow | undefined;
      if (existing) {
        return {
          created: false,
          row: existing,
          payload: parsePayload(existing.payload_json),
        };
      }
      database
        .prepare(
          `INSERT INTO operations
            (
              id, kind, actor_user_id, step, state, payload_json,
              result_json, attempt_count, next_attempt_at, lease_owner,
              lease_expires_at, created_at, updated_at
            )
           VALUES (
             ?, 'create_resource', ?, 'reserved', 'pending', ?, NULL,
             0, ?, 'product-api', ?, ?, ?
           )`
        )
        .run(
          input.operationId,
          input.actorUserId,
          JSON.stringify(input.payload),
          input.createdAt,
          input.createdAt + 60_000,
          input.createdAt,
          input.createdAt
        );
      return {
        created: true,
        row: database
          .prepare("SELECT * FROM operations WHERE id = ?")
          .get(input.operationId) as unknown as OperationRow,
        payload: input.payload,
      };
    });
  }

  async getOperation(operationId: string, actorUserId: string): Promise<OperationRow | null> {
    return (
      (this._database.connection
        .prepare(
          "SELECT * FROM operations WHERE id = ? AND actor_user_id = ?"
        )
        .get(operationId, actorUserId) as OperationRow | undefined) ?? null
    );
  }

  async markAttempt(operationId: string, attemptedAt: number): Promise<void> {
    this._database.connection
      .prepare(
        `UPDATE operations
         SET attempt_count = attempt_count + 1, updated_at = ?,
             last_error_code = NULL, last_error_message = NULL
         WHERE id = ? AND state = 'pending'`
      )
      .run(attemptedAt, operationId);
  }

  async markUnitCreated(operationId: string, updatedAt: number): Promise<void> {
    this._database.connection
      .prepare(
        `UPDATE operations SET step = 'unit_created', updated_at = ?
         WHERE id = ? AND state = 'pending'`
      )
      .run(updatedAt, operationId);
  }

  async markPendingError(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    nextAttemptAt: number,
    updatedAt: number
  ): Promise<void> {
    this._database.connection
      .prepare(
        `UPDATE operations
         SET last_error_code = ?, last_error_message = ?,
             next_attempt_at = ?, lease_owner = NULL,
             lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND state = 'pending'`
      )
      .run(
        error.code,
        error.message,
        nextAttemptAt,
        updatedAt,
        operationId
      );
  }

  async markFailed(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    updatedAt: number
  ): Promise<void> {
    this._database.connection
      .prepare(
        `UPDATE operations
         SET state = 'failed', last_error_code = ?,
             last_error_message = ?, lease_owner = NULL,
             lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND state = 'pending'`
      )
      .run(error.code, error.message, updatedAt, operationId);
  }

  async claimDue(
    workerId: string,
    now: number,
    leaseExpiresAt: number,
    limit: number
  ): Promise<ReservedCreateResource[]> {
    return this._database.transaction((database) => {
      const rows = database
        .prepare(
          `SELECT * FROM operations
           WHERE kind = 'create_resource'
             AND state = 'pending'
             AND next_attempt_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY next_attempt_at, created_at LIMIT ?`
        )
        .all(now, now, limit) as unknown as OperationRow[];
      const claim = database.prepare(
        `UPDATE operations
         SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ?`
      );
      for (const row of rows) {
        claim.run(workerId, leaseExpiresAt, now, row.id);
      }
      return rows.map((row) => ({
        created: false,
        row,
        payload: parsePayload(row.payload_json),
      }));
    });
  }

  async retry(operationId: string, actorUserId: string, updatedAt: number): Promise<ReservedCreateResource | null> {
    return this._database.transaction((db) => {
      const row = db.prepare(`UPDATE operations
         SET state = 'pending', next_attempt_at = ?, last_error_code = NULL,
             last_error_message = NULL, lease_owner = 'product-api', lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND actor_user_id = ? AND kind = 'create_resource' AND state = 'failed' RETURNING *`)
        .get(updatedAt, updatedAt + 60_000, updatedAt, operationId, actorUserId) as OperationRow | undefined;
      if (!row) return null;
      assertFileQuota(db, actorUserId, 0);
      return { created: false, row, payload: parsePayload(row.payload_json) };
    });
  }

  async completeCreateResource(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CreateResourcePayload;
    readonly completedAt: number;
  }): Promise<OperationRow> {
    return this._database.transaction((database) => {
      const existing = database
        .prepare("SELECT 1 FROM resources WHERE id = ?")
        .get(input.payload.resourceId);
      if (!existing) {
        database
          .prepare(
            `INSERT INTO nodes
              (id, space_id, parent_id, name, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            input.payload.nodeId,
            input.payload.spaceId,
            input.payload.parentNodeId,
            input.payload.name,
            input.actorUserId,
            input.completedAt,
            input.completedAt
          );
        database
          .prepare(
            `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
             VALUES (?, ?, 'univer', ?, ?)`
          )
          .run(
            input.payload.resourceId,
            input.payload.nodeId,
            input.completedAt,
            input.completedAt
          );
        database
          .prepare(
            `INSERT INTO univer_resources (resource_id, unit_id, unit_type)
             VALUES (?, ?, ?)`
          )
          .run(
            input.payload.resourceId,
            input.payload.unitId,
            input.payload.unitType
          );
      }
      const resultJson = JSON.stringify({
        nodeId: input.payload.nodeId,
        resourceId: input.payload.resourceId,
        unitId: input.payload.unitId,
      });
      database
        .prepare(
          `UPDATE operations
           SET step = 'completed', state = 'completed', result_json = ?,
               last_error_code = NULL, last_error_message = NULL,
               lease_owner = NULL, lease_expires_at = NULL,
               updated_at = ?, completed_at = ?
           WHERE id = ?`
        )
        .run(
          resultJson,
          input.completedAt,
          input.completedAt,
          input.operationId
        );
      return database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(input.operationId) as unknown as OperationRow;
    });
  }

  async recordRecent(
    userId: string,
    resourceId: string,
    openedAt: number
  ): Promise<void> {
    this._database.connection
      .prepare(
        `INSERT INTO recent_resources (user_id, resource_id, last_opened_at)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id, resource_id)
         DO UPDATE SET last_opened_at = excluded.last_opened_at`
      )
      .run(userId, resourceId, openedAt);
  }
}

function parsePayload(value: string): CreateResourcePayload {
  return JSON.parse(value) as CreateResourcePayload;
}
