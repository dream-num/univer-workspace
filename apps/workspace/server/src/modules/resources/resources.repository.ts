import type { WorkspaceDatabase } from "../../db/database.js";
import type {
  CreateResourcePayload,
  OperationState,
  OperationView,
} from "./resources.types.js";

export interface OperationRow {
  readonly id: string;
  readonly kind: "create_resource";
  readonly actor_user_id: string;
  readonly step: string;
  readonly state: OperationState;
  readonly payload_json: string;
  readonly result_json: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface ReservedCreateResource {
  readonly created: boolean;
  readonly row: OperationRow;
  readonly payload: CreateResourcePayload;
}

export class ResourcesRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  reserveCreateResource(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CreateResourcePayload;
    readonly createdAt: number;
  }): ReservedCreateResource {
    return this._database.transaction((database) => {
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

  getOperation(operationId: string, actorUserId: string): OperationRow | null {
    return (
      (this._database.connection
        .prepare(
          "SELECT * FROM operations WHERE id = ? AND actor_user_id = ?"
        )
        .get(operationId, actorUserId) as OperationRow | undefined) ?? null
    );
  }

  markAttempt(operationId: string, attemptedAt: number): void {
    this._database.connection
      .prepare(
        `UPDATE operations
         SET attempt_count = attempt_count + 1, updated_at = ?,
             last_error_code = NULL, last_error_message = NULL
         WHERE id = ? AND state = 'pending'`
      )
      .run(attemptedAt, operationId);
  }

  markUnitCreated(operationId: string, updatedAt: number): void {
    this._database.connection
      .prepare(
        `UPDATE operations SET step = 'unit_created', updated_at = ?
         WHERE id = ? AND state = 'pending'`
      )
      .run(updatedAt, operationId);
  }

  markPendingError(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    nextAttemptAt: number,
    updatedAt: number
  ): void {
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

  markFailed(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    updatedAt: number
  ): void {
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

  claimDue(
    workerId: string,
    now: number,
    leaseExpiresAt: number,
    limit: number
  ): ReservedCreateResource[] {
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

  retry(operationId: string, actorUserId: string, updatedAt: number): boolean {
    return (
      this._database.connection
        .prepare(
          `UPDATE operations
           SET state = 'pending', next_attempt_at = ?,
               last_error_code = NULL, last_error_message = NULL,
               updated_at = ?
           WHERE id = ? AND actor_user_id = ?
             AND kind = 'create_resource' AND state = 'failed'`
        )
        .run(updatedAt, updatedAt, operationId, actorUserId).changes > 0
    );
  }

  completeCreateResource(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CreateResourcePayload;
    readonly completedAt: number;
  }): OperationRow {
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

  recordRecent(
    userId: string,
    resourceId: string,
    openedAt: number
  ): void {
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

export function operationView(row: OperationRow): OperationView {
  return {
    id: row.id,
    kind: "createResource",
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    result:
      row.result_json === null
        ? null
        : (JSON.parse(row.result_json) as Readonly<Record<string, unknown>>),
    error:
      row.last_error_code && row.last_error_message
        ? {
            code: row.last_error_code,
            message: row.last_error_message,
          }
        : null,
  };
}

function parsePayload(value: string): CreateResourcePayload {
  return JSON.parse(value) as CreateResourcePayload;
}
