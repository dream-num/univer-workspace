import { DatabaseSync } from "node:sqlite";
// Keep database parsing off the Observer HTTP event loop.
import { parentPort, workerData } from "node:worker_threads";
import type {
  ActivityBucket,
  ActivityRank,
  ActivityTotals,
  ChangesetQuery,
  ChangesetQueryResult,
} from "./changeset-query-types.js";

interface Input {
  readonly filename: string;
  readonly query: ChangesetQuery;
}

interface StoredRow {
  readonly unit_id: string;
  readonly payload_json: string;
}

const input = workerData as Input;

try {
  parentPort?.postMessage({ ok: true, result: runQuery(input.filename, input.query) });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function runQuery(filename: string, query: ChangesetQuery): ChangesetQueryResult {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    requireTable(database, "collaboration_changesets");
    requireTable(database, "collaboration_worktree_changesets");

    const bucketMs = chooseBucketMs(query.to - query.from);
    const buckets = new Map<number, MutableTotals>();
    for (let start = query.from; start < query.to; start += bucketMs) {
      buckets.set(start, emptyTotals());
    }
    const totals = emptyTotals();
    const users = new Map<string, MutableTotals>();
    const units = new Map<string, MutableTotals>();
    let mutationSizePresentCount = 0;
    let mutationSizeMissingCount = 0;
    let missingCreateTimeCount = 0;
    let latestChangesetTime: number | null = null;

    for (const table of selectedTables(query.scope)) {
      const rows = database
        .prepare(
          `SELECT unit_id, payload_json FROM ${table}
           ${query.unitId ? "WHERE unit_id = ?" : ""}`
        )
        .all(...(query.unitId ? [query.unitId] : [])) as unknown as StoredRow[];
      for (const row of rows) {
        const payload = parsePayload(row.payload_json);
        if (!payload) continue;
        const userId = typeof payload.userID === "string" ? payload.userID : "unknown";
        if (query.userId && userId !== query.userId) continue;
        const createTime = typeof payload.createTime === "number" && Number.isFinite(payload.createTime)
          ? payload.createTime * 1_000
          : null;
        if (createTime === null) {
          missingCreateTimeCount += 1;
          continue;
        }
        if (createTime < query.from || createTime >= query.to) continue;
        latestChangesetTime = latestChangesetTime === null ? createTime : Math.max(latestChangesetTime, createTime);
        const mutationCount = Array.isArray(payload.mutations) ? payload.mutations.length : 0;
        const mutationSize = typeof payload.mutationSize === "number" && Number.isFinite(payload.mutationSize) && payload.mutationSize >= 0
          ? payload.mutationSize
          : null;
        if (mutationSize === null) mutationSizeMissingCount += 1;
        else mutationSizePresentCount += 1;
        const value = { changesetCount: 1, mutationCount, mutationSize: mutationSize ?? 0 };
        add(totals, value);
        const bucketStart = query.from + Math.floor((createTime - query.from) / bucketMs) * bucketMs;
        add(buckets.get(bucketStart)!, value);
        add(mapTotals(users, userId), value);
        add(mapTotals(units, row.unit_id), value);
      }
    }

    return {
      bucketMs,
      buckets: [...buckets].map(([start, value]): ActivityBucket => ({ start, ...value })),
      totals,
      users: rank(users, query.measure),
      units: rank(units, query.measure),
      mutationSizePresentCount,
      mutationSizeMissingCount,
      missingCreateTimeCount,
      latestChangesetTime,
    };
  } finally {
    database.close();
  }
}

function selectedTables(scope: ChangesetQuery["scope"]): readonly string[] {
  if (scope === "trunk") return ["collaboration_changesets"];
  if (scope === "worktree") return ["collaboration_worktree_changesets"];
  return ["collaboration_changesets", "collaboration_worktree_changesets"];
}

function requireTable(database: DatabaseSync, table: string): void {
  const row = database.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!row) throw new Error(`Collaboration database table ${table} is unavailable.`);
}

function parsePayload(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

interface MutableTotals {
  changesetCount: number;
  mutationCount: number;
  mutationSize: number;
}

function emptyTotals(): MutableTotals {
  return { changesetCount: 0, mutationCount: 0, mutationSize: 0 };
}

function add(target: MutableTotals, value: ActivityTotals): void {
  target.changesetCount += value.changesetCount;
  target.mutationCount += value.mutationCount;
  target.mutationSize += value.mutationSize;
}

function mapTotals(map: Map<string, MutableTotals>, key: string): MutableTotals {
  const existing = map.get(key);
  if (existing) return existing;
  const created = emptyTotals();
  map.set(key, created);
  return created;
}

function rank(map: Map<string, MutableTotals>, measure: ChangesetQuery["measure"]): ActivityRank[] {
  return [...map].map(([id, totals]) => ({ id, ...totals })).sort((a, b) =>
    b[measure] - a[measure] || a.id.localeCompare(b.id)
  ).slice(0, 20);
}

function chooseBucketMs(duration: number): number {
  if (duration <= 60 * 60 * 1_000) return 60 * 1_000;
  if (duration <= 6 * 60 * 60 * 1_000) return 5 * 60 * 1_000;
  if (duration <= 24 * 60 * 60 * 1_000) return 15 * 60 * 1_000;
  if (duration <= 7 * 24 * 60 * 60 * 1_000) return 60 * 60 * 1_000;
  return 6 * 60 * 60 * 1_000;
}
