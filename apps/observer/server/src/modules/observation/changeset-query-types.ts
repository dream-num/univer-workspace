/** Collaboration changeset analytics contracts owned by the Observer app. */
export type ChangesetScope = "all" | "trunk" | "worktree";
export type ChangesetMeasure = "changesetCount" | "mutationCount" | "mutationSize";

export interface ChangesetQuery {
  readonly from: number;
  readonly to: number;
  readonly userId: string | null;
  readonly unitId: string | null;
  readonly scope: ChangesetScope;
  readonly measure: ChangesetMeasure;
}

export interface ActivityTotals {
  readonly changesetCount: number;
  readonly mutationCount: number;
  readonly mutationSize: number;
}

export interface ActivityBucket extends ActivityTotals {
  readonly start: number;
}

export interface ActivityRank extends ActivityTotals {
  readonly id: string;
}

export interface ChangesetQueryResult {
  readonly bucketMs: number;
  readonly buckets: readonly ActivityBucket[];
  readonly totals: ActivityTotals;
  readonly users: readonly ActivityRank[];
  readonly units: readonly ActivityRank[];
  readonly mutationSizePresentCount: number;
  readonly mutationSizeMissingCount: number;
  readonly missingCreateTimeCount: number;
  readonly latestChangesetTime: number | null;
}
