import type { OperationRow } from "../operations/index.js";
import type { RevertPayload } from "./reverts.types.js";

export interface RevertOperationRow extends OperationRow {
  readonly attempt_count: number;
}

export interface RevertError {
  readonly code: string;
  readonly message: string;
}

/**
 * The `revert_worktrees` Operation. Every write after the reservation names the runner that holds its lease and
 * renews it, and does nothing once another runner took the lease, so two replicas never act on one revert at once.
 */
export interface RevertsRepository {
  find(operationId: string): Promise<RevertOperationRow | null>;
  /** Stores the Operation leased to `runner`. When another request stored this key first, returns that row with `created: false`. */
  reserve(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: RevertPayload;
    readonly runner: string;
    readonly createdAt: number;
    readonly leaseExpiresAt: number;
  }): Promise<{ readonly created: boolean; readonly row: RevertOperationRow }>;
  /** Counts an attempt by the lease holder and returns the row, or null when it is no longer pending or no longer theirs. */
  beginAttempt(operationId: string, runner: string, now: number, leaseExpiresAt: number): Promise<RevertOperationRow | null>;
  /** Stores the payload and renews the lease. False when the Operation is no longer pending or no longer the runner's. */
  save(operationId: string, runner: string, payload: RevertPayload, now: number, leaseExpiresAt: number): Promise<boolean>;
  claimDue(workerId: string, now: number, leaseExpiresAt: number, limit: number): Promise<RevertOperationRow[]>;
  defer(input: {
    readonly operationId: string;
    readonly runner: string;
    readonly error: RevertError;
    readonly nextAttemptAt: number;
    readonly updatedAt: number;
  }): Promise<boolean>;
  complete(input: {
    readonly operationId: string;
    readonly runner: string;
    readonly payload: RevertPayload;
    readonly result: Readonly<Record<string, unknown>>;
    readonly completedAt: number;
  }): Promise<boolean>;
  fail(input: {
    readonly operationId: string;
    readonly runner: string;
    readonly error: RevertError;
    readonly failedAt: number;
  }): Promise<boolean>;
  retry(operationId: string, actorUserId: string, runner: string, now: number, leaseExpiresAt: number): Promise<boolean>;
}
