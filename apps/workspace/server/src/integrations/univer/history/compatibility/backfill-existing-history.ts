import type {
  IHistoryDatabaseAdapter,
  IUniverHistoryService,
} from "@univerjs-pro/collaboration-history-service";
import type { IDatabaseAdapter } from "@univerjs-pro/collaboration-service";

export interface ExistingHistoryUnit {
  readonly unitId: string;
  readonly userId: string;
  readonly createdAt: number;
}

/**
 * Startup-only compatibility for Units that existed before persistent History
 * was enabled. History is a derived index, so replaying authoritative Trunk
 * changesets is safe and does not change Unit content or core revisions.
 *
 * Keep this out of request paths. It may be removed only after old deployments
 * have been backfilled and live History indexing has a lossless outbox/retry
 * path; `historyService.attach()` alone is explicitly best-effort.
 */
export async function backfillExistingHistory(options: {
  readonly collaborationDatabase: IDatabaseAdapter;
  readonly historyDatabase: IHistoryDatabaseAdapter;
  readonly historyService: IUniverHistoryService;
  readonly units: readonly ExistingHistoryUnit[];
}): Promise<void> {
  const seen = new Set<string>();
  for (const unit of options.units) {
    if (seen.has(unit.unitId)) continue;
    seen.add(unit.unitId);
    await backfillUnit(options, unit);
  }
}

async function backfillUnit(
  options: {
    readonly collaborationDatabase: IDatabaseAdapter;
    readonly historyDatabase: IHistoryDatabaseAdapter;
    readonly historyService: IUniverHistoryService;
  },
  seed: ExistingHistoryUnit
): Promise<void> {
  const databaseContext = {
    userID: seed.userId,
    customData: { source: "workspace-history-compatibility-backfill" },
    request: {},
  };
  const unit = await options.collaborationDatabase.getUnit(
    databaseContext,
    seed.unitId
  );
  if (!unit) return;

  const state = await options.historyDatabase.getIndexState(seed.unitId);
  if (
    state &&
    (state.type !== unit.type || state.latestRevision > unit.headRevision)
  ) {
    throw new Error(
      `History index for ${seed.unitId} does not match its authoritative Unit head.`
    );
  }
  if (state?.latestRevision === unit.headRevision) return;

  let previousCommittedAt = validTimestamp(seed.createdAt, 0);
  let nextRevision = state ? state.latestRevision + 1 : 1;
  if (state) {
    const previous = await options.historyDatabase.getRevision(
      seed.unitId,
      state.latestRevision
    );
    if (!previous) {
      throw new Error(
        `History index for ${seed.unitId} is missing revision ${state.latestRevision}.`
      );
    }
    previousCommittedAt = previous.committedAt;
  }

  if (nextRevision === 1) {
    await options.historyService.indexUnitCreated(
      {
        unitID: seed.unitId,
        type: unit.type,
        createdAt: previousCommittedAt,
      },
      {
        userID: seed.userId,
        customData: databaseContext.customData,
      }
    );
    nextRevision = 2;
  }
  if (nextRevision > unit.headRevision) return;

  const range = await options.collaborationDatabase.getChangesets(
    databaseContext,
    seed.unitId,
    { from: nextRevision - 1, to: unit.headRevision }
  );
  if (range.latestRevision !== unit.headRevision) {
    throw new Error(
      `History compatibility backfill for ${seed.unitId} observed an unstable Unit head.`
    );
  }

  let expectedRevision = nextRevision;
  for (const changeset of range.changesets) {
    if (changeset.revision !== expectedRevision) {
      throw new Error(
        `History compatibility backfill for ${seed.unitId} is missing revision ${expectedRevision}.`
      );
    }
    const committedAt = changesetTimestamp(
      changeset.createTime,
      previousCommittedAt
    );
    await options.historyService.indexChangeset(
      { changeset, committedAt },
      {
        userID: changeset.userID || seed.userId,
        customData: databaseContext.customData,
      }
    );
    previousCommittedAt = committedAt;
    expectedRevision += 1;
  }
  if (expectedRevision !== unit.headRevision + 1) {
    throw new Error(
      `History compatibility backfill for ${seed.unitId} did not reach revision ${unit.headRevision}.`
    );
  }
}

function changesetTimestamp(
  value: number | undefined,
  previous: number
): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
    return previous + 1;
  }
  const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  return validTimestamp(milliseconds, previous + 1, previous);
}

function validTimestamp(
  value: number,
  fallback: number,
  minimum = 0
): number {
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}
