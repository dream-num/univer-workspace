import type { UniverType } from "@univerjs/protocol";
import type { UnitType } from "../access/index.js";
import type { OperationView } from "../operations/index.js";
import type { PublicUser } from "../permissions/index.js";

/** restore: back to the revision before the set's first merge. trash: a file the set added. recover: one it removed. none: kept. */
export type RevertAction = "restore" | "trash" | "recover" | "none";

/**
 * A plan's items are ready, blocked, done, unavailable or refused. A finished revert's are done, blocked,
 * unavailable or failed.
 */
export type RevertItemState = "ready" | "blocked" | "done" | "unavailable" | "refused" | "failed";

export interface RevertLaterEdit {
  /** Null when the editor is no longer a User. */
  readonly user: PublicUser | null;
  readonly revisions: number;
  readonly lastEditedAt: string | null;
}

export interface RevertItem {
  readonly action: RevertAction;
  readonly state: RevertItemState;
  readonly name: string;
  readonly nodeId: string | null;
  readonly unitId: string | null;
  readonly unitType: UnitType | null;
  /** restore only: the revision before the set's first merge on this Unit. */
  readonly targetRevision: number | null;
  /** restore only: Trunk head when the item was read. A force overwrites later edits through it and no further. */
  readonly headRevision: number | null;
  /** Trunk revisions after the set's first merge on this Unit that are not the set's own merges, by editor. */
  readonly laterEdits: readonly RevertLaterEdit[];
  readonly reason: string | null;
}

export interface RevertPullRequest {
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
}

export interface RevertPlan {
  readonly pullRequests: readonly RevertPullRequest[];
  readonly items: readonly RevertItem[];
  readonly capabilities: {
    readonly revert: boolean;
    /** Only a person in the browser overwrites later edits, one blocked Unit at a time. */
    readonly force: boolean;
  };
  /** Why the actor cannot revert, in plain words; null when they can. */
  readonly refusal: string | null;
}

export type RevertScope =
  | { readonly kind: "pullRequest"; readonly worktreeId: string }
  | { readonly kind: "issue"; readonly spaceId: string; readonly number: number };

/** A blocked Unit a person chose to overwrite, and the head they saw, so a later edit than that one still blocks it. */
export interface RevertForce {
  readonly unitId: string;
  readonly headRevision: number;
}

/** An item as the Operation keeps it: what was planned from server facts and how far it got. */
export interface RevertWork extends RevertItem {
  readonly univerType?: UniverType;
  /** restore only: the Trunk revision each merge of the set wrote on this Unit. */
  readonly mergeRevisions?: readonly number[];
  readonly batchId?: string;
  /** restore only: the changeset stored before it was submitted, which a resumed revert submits again unchanged. */
  readonly attempt?: { readonly reqId: number; readonly baseRev: number };
}

export interface RevertPayload {
  readonly scope: RevertScope;
  readonly force: readonly RevertForce[];
  readonly items: readonly RevertWork[];
}

export type RevertResult =
  | {
      readonly status: 200 | 201;
      readonly body: { readonly operation: OperationView; readonly items: readonly RevertItem[] };
    }
  | { readonly status: 202; readonly body: { readonly operation: OperationView } };

export interface RevertsModule {
  plan(userId: string, browser: boolean, scope: RevertScope): Promise<RevertPlan>;
  revert(userId: string, browser: boolean, scope: RevertScope, operationId: unknown, input: unknown): Promise<RevertResult>;
  retry(userId: string, operationId: string): Promise<void>;
  resumeDue(workerId: string, limit?: number): Promise<number>;
}
