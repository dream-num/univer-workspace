import type { CreateResourcePayload, OperationState, OperationView } from "./resources.types.js";

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

export interface ResourcesRepository {
  reserveCreateResource(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CreateResourcePayload;
    readonly createdAt: number;
  }): ReservedCreateResource;
  getOperation(operationId: string, actorUserId: string): OperationRow | null;
  markAttempt(operationId: string, attemptedAt: number): void;
  markUnitCreated(operationId: string, updatedAt: number): void;
  markPendingError(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    nextAttemptAt: number,
    updatedAt: number
  ): void;
  markFailed(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    updatedAt: number
  ): void;
  claimDue(
    workerId: string,
    now: number,
    leaseExpiresAt: number,
    limit: number
  ): ReservedCreateResource[];
  retry(operationId: string, actorUserId: string, updatedAt: number): boolean;
  completeCreateResource(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CreateResourcePayload;
    readonly completedAt: number;
  }): OperationRow;
  recordRecent(
    userId: string,
    resourceId: string,
    openedAt: number
  ): void;
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
