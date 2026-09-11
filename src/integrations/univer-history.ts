/**
 * Univer History HTTP protocol for the edge ChatAgent.
 * Wire format matches `@univerjs-pro/collaboration-history-endpoint`.
 */
export const HISTORY_OK = { code: 1, message: "" } as const;
const DEFAULT_PAGE_SIZE = 20;
const GROUP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_USER = {
  userID: "user_admin",
  name: "Administrator",
  avatar: ""
} as const;

export interface HistoryChangesetEntry {
  readonly id: string;
  readonly rev: number;
  readonly clientId: string;
  readonly createdAt: number;
  readonly changeset: Record<string, unknown>;
}

export interface HistoryUnitInfo {
  readonly unitId: string;
  readonly rev: number;
  readonly createdAt: number;
}

interface HistoryRecord {
  readonly id: string;
  readonly userId: string;
  readonly startRevision: number;
  readonly endRevision: number;
  readonly createdAt: number;
  readonly startCreatedAt: number;
  readonly endCreatedAt: number;
  readonly commands: readonly string[];
}

export function parsePositiveInt(value: string | null, fallback?: number): number | null {
  if (value === null || value === "") {
    return fallback ?? null;
  }
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

export function buildHistoryListBody(
  unitId: string,
  unit: HistoryUnitInfo | null,
  entries: readonly HistoryChangesetEntry[],
  query: { length: number; lastLabel?: string }
): Record<string, unknown> {
  const records = buildHistoryRecords(unitId, unit, entries);
  const before = query.lastLabel ? Number(query.lastLabel) : undefined;
  const filtered =
    Number.isFinite(before) && (before as number) > 0
      ? records.filter((record) => record.startRevision < (before as number))
      : records;
  const page = filtered.slice(0, query.length);
  const hasMore = filtered.length > page.length;
  const lastLabel = page.length > 0 ? String(page[page.length - 1].startRevision) : "";
  const datas: Record<string, unknown> = {};
  const users: Record<string, typeof DEFAULT_USER> = {};
  const historyIds: string[] = [];

  for (const record of page) {
    historyIds.push(record.id);
    users[record.userId] = {
      ...DEFAULT_USER,
      userID: record.userId
    };
    datas[record.id] = {
      userId: record.userId,
      unitId,
      userIds: [record.userId],
      command: record.commands,
      createTime: String(record.createdAt),
      recoverTime: "",
      startRevision: record.startRevision,
      endRevision: record.endRevision,
      origin: 1,
      startRevCreateTime: record.startCreatedAt,
      endRevCreateTime: record.endCreatedAt
    };
  }

  return {
    error: HISTORY_OK,
    hasMore,
    lastLabel,
    historyIds,
    entities: { datas, users }
  };
}

export function buildHistoryCreatorsBody(
  unit: HistoryUnitInfo | null,
  entries: readonly HistoryChangesetEntry[]
): Record<string, unknown> {
  const userIds = new Set<string>();
  if (unit) userIds.add(DEFAULT_USER.userID);
  for (const entry of entries) {
    userIds.add(normalizeUserId(entry.clientId));
  }
  return {
    error: HISTORY_OK,
    creators: [...userIds].map((userId) => ({
      userId,
      name: userId === DEFAULT_USER.userID ? DEFAULT_USER.name : userId,
      avatar: "",
      origins: [1]
    }))
  };
}

export function buildHistoryChangesetsBody(
  unitId: string,
  entries: readonly HistoryChangesetEntry[],
  startRevision: number,
  endRevision: number
): Record<string, unknown> {
  const changesets = entries
    .filter((entry) => entry.rev >= startRevision && entry.rev <= endRevision)
    .sort((a, b) => a.rev - b.rev)
    .map((entry) => toProtocolChangeset(unitId, entry));
  const users: Record<string, typeof DEFAULT_USER> = {};
  for (const entry of entries) {
    const userId = normalizeUserId(entry.clientId);
    users[userId] = { ...DEFAULT_USER, userID: userId };
  }
  return {
    error: HISTORY_OK,
    changesets,
    users
  };
}

export function extractCommands(changeset: Record<string, unknown>): string[] {
  const mutations = changeset.mutations ?? changeset.mutation;
  if (Array.isArray(mutations)) {
    return [
      ...new Set(
        mutations
          .map((item) =>
            item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
              ? (item as { id: string }).id
              : ""
          )
          .filter(Boolean)
      )
    ];
  }
  if (mutations && typeof mutations === "object" && typeof (mutations as { id?: unknown }).id === "string") {
    return [(mutations as { id: string }).id];
  }
  return [];
}

function buildHistoryRecords(
  unitId: string,
  unit: HistoryUnitInfo | null,
  entries: readonly HistoryChangesetEntry[]
): HistoryRecord[] {
  const sorted = [...entries].sort((a, b) => b.rev - a.rev || b.createdAt - a.createdAt);
  const groups: HistoryRecord[] = [];

  for (const entry of sorted) {
    const userId = normalizeUserId(entry.clientId);
    const commands = extractCommands(entry.changeset);
    const current = groups[groups.length - 1];
    if (
      current &&
      current.userId === userId &&
      current.startRevision === entry.rev + 1 &&
      current.endCreatedAt - entry.createdAt <= GROUP_INTERVAL_MS
    ) {
      groups[groups.length - 1] = {
        ...current,
        id: historyId(unitId, entry.rev, current.endRevision),
        startRevision: entry.rev,
        startCreatedAt: entry.createdAt,
        commands: [...commands, ...current.commands]
      };
      continue;
    }
    groups.push({
      id: historyId(unitId, entry.rev, entry.rev),
      userId,
      startRevision: entry.rev,
      endRevision: entry.rev,
      createdAt: entry.createdAt,
      startCreatedAt: entry.createdAt,
      endCreatedAt: entry.createdAt,
      commands
    });
  }

  const minChangesetRev = sorted.length > 0 ? Math.min(...sorted.map((entry) => entry.rev)) : Infinity;
  if (unit && minChangesetRev > 1) {
    groups.push({
      id: historyId(unitId, 1, 1),
      userId: DEFAULT_USER.userID,
      startRevision: 1,
      endRevision: 1,
      createdAt: unit.createdAt,
      startCreatedAt: unit.createdAt,
      endCreatedAt: unit.createdAt,
      commands: []
    });
  }

  return groups;
}

function toProtocolChangeset(unitId: string, entry: HistoryChangesetEntry): Record<string, unknown> {
  const cs = entry.changeset;
  return {
    ...cs,
    unitID: typeof cs.unitID === "string" ? cs.unitID : unitId,
    revision: typeof cs.revision === "number" ? cs.revision : entry.rev,
    userID: typeof cs.userID === "string" && cs.userID ? cs.userID : normalizeUserId(entry.clientId),
    memberID: typeof cs.memberID === "string" ? cs.memberID : entry.clientId,
    createTime:
      typeof cs.createTime === "number"
        ? cs.createTime
        : Math.floor(entry.createdAt / 1000)
  };
}

function historyId(unitId: string, startRevision: number, endRevision: number): string {
  return `history_${unitId}_${startRevision}_${endRevision}`;
}

function normalizeUserId(clientId: string): string {
  return clientId && clientId !== "unknown" ? clientId : DEFAULT_USER.userID;
}
