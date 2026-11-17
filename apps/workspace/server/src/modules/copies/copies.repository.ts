import type { OperationRow } from "../operations/index.js";
import type { UniverAssetRow } from "../univer-assets/univer-assets.repository.js";
import type { CopyPayload, CopyStep } from "./copies.types.js";

export interface CopyOperationRow extends OperationRow {
  readonly step: CopyStep;
  readonly attempt_count: number;
}

export interface CopyError {
  readonly code: string;
  readonly message: string;
}

export interface CopiesRepository {
  personalSpaceId(userId: string): Promise<string | null>;
  /** The Trunk Assets among `ids`. The caller passes every UUID found in the source Unit. */
  findTrunkAssets(ids: readonly string[]): Promise<UniverAssetRow[]>;
  /** The Operation stored under this Idempotency-Key, whoever started it and whatever its kind. */
  find(operationId: string): Promise<CopyOperationRow | null>;
  /**
   * Checks the target and the file quota and stores the Operation in one transaction. When
   * another request stored this Idempotency-Key first, returns that row with `created: false`.
   */
  reserve(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CopyPayload;
    readonly createdAt: number;
  }): Promise<{ readonly created: boolean; readonly row: CopyOperationRow }>;
  /** Counts an attempt and returns the row, or null when the Operation is no longer pending. */
  beginAttempt(operationId: string, attemptedAt: number): Promise<CopyOperationRow | null>;
  setStep(operationId: string, step: "objects_copied" | "unit_created", updatedAt: number): Promise<void>;
  /**
   * Records the error, releases the lease and schedules the next attempt, optionally entering
   * `abandoning`. Returns false when the Operation is no longer pending.
   */
  defer(input: {
    readonly operationId: string;
    readonly error: CopyError;
    readonly abandoning: boolean;
    readonly nextAttemptAt: number;
    readonly updatedAt: number;
  }): Promise<boolean>;
  claimDue(workerId: string, now: number, leaseExpiresAt: number, limit: number): Promise<CopyOperationRow[]>;
  /**
   * Creates the copy's product rows and completes the Operation in one transaction. Returns the
   * completed row unchanged on a repeat, and refuses an Operation that is being abandoned.
   */
  complete(input: {
    readonly operationId: string;
    readonly actorUserId: string;
    readonly payload: CopyPayload;
    readonly completedAt: number;
  }): Promise<CopyOperationRow>;
  /** Fails a pending Operation and queues its copied objects for deletion in one transaction. */
  fail(operationId: string, payload: CopyPayload, failedAt: number): Promise<void>;
}
