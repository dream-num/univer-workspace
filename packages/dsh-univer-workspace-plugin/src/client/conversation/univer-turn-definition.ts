/**
 * Projects structured Univer Workspace tool calls/results into a replay-safe
 * per-Turn operation log — the remote-document counterpart of the
 * dsh-univer-office file-operation model.
 * @module dsh-univer-workspace-plugin/client/conversation/univer-turn-definition
 */

import type {
  ConversationNodeDefinition,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { TurnTailOwnerProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { SessionEvent } from "@deepseek-ai/dsh-session/types";

export type UniverOperationName = "new" | "open" | "status" | "unit" | "inspect" | "execute" | "import" | "export" | "worktree";
export type UniverOperationPhase = "pending" | "succeeded" | "failed";
export type UniverTurnLifecycle = "trunk" | "draft" | "ready" | "merged" | "discarded" | "unchanged";

/** One durable Univer tool operation recovered from a call/result pair. */
export interface UniverTurnOperation {
  readonly callId: string;
  readonly name: UniverOperationName;
  readonly action: string | null;
  /** Stable document key: `res:<resourceId>` / `unit:<unitId>` / `name:<label>`. */
  readonly docKey: string;
  /** Display label (document name) once known. */
  readonly label: string | null;
  readonly unitType: string | null;
  /** Resource identity supplied by the tool call or resolved by its result. */
  readonly resourceId: string | null;
  readonly worktreeId: string | null;
  readonly unitId: string | null;
  /** Worktree-local Units cannot be resolved as product Resources until merge. */
  readonly source?: "trunk" | "worktree" | null;
  readonly readOnly: boolean;
  readonly phase: UniverOperationPhase;
}

/** All Univer operations for one document in one Turn. */
export interface UniverTurnFile {
  readonly docKey: string;
  readonly operations: readonly UniverTurnOperation[];
}

/** Replay-safe Turn projection published into the conversation timeline. */
export interface UniverTurnData {
  readonly files: readonly UniverTurnFile[];
}

/** Whether a document key has enough identity for the viewer state API. */
export function isViewerDocKey(docKey: string): boolean {
  return docKey.startsWith("res:") || docKey.startsWith("wt:");
}

export interface UniverTurnMatch extends UniverTurnData {
  readonly turn: number;
}

export interface UniverTurnOutcome {
  readonly primaryWorktreeId: string | null;
  readonly lifecycle: UniverTurnLifecycle;
  readonly preferredUnitId: string | null;
  readonly preferredUnitType: string | null;
  readonly preferredLabel: string | null;
  readonly readOnly: boolean;
  readonly changedContent: boolean;
}

interface UniverTurnState extends UniverTurnData {
  readonly turn: number;
}

declare module "@deepseek-ai/dsh-client-runtime/client" {
  interface ConversationTurnDataMap {
    /** Structured Univer Workspace operations performed during this Turn. */
    univerTurn: UniverTurnData;
  }
}

/** Project structured Univer tool calls and results into a replay-safe Turn log. */
export const univerTurnDefinition = {
  kind: "univerTurn",
  match(event: SessionEvent) {
    if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
    if (event.type === "tool/call" || event.type === "tool/result") return { id: String(event.data.turn), role: "update" };
    return null;
  },
  start(_context, match): UniverTurnState {
    if (match.event.type !== "turn/start") throw new Error("univerTurn start match must be turn/start");
    return { turn: match.event.data.turn, files: [] };
  },
  update(context, match): UniverTurnState {
    if (match.event.type === "tool/call") return addCall(context.state, match.event.data);
    if (match.event.type === "tool/result") return applyResult(context.state, match.event.data);
    return context.state;
  },
  buildLocationData(context, scope) {
    if (scope !== "turn" || context.state === undefined) return null;
    return { kind: "turn", turn: context.state.turn, key: "univerTurn", value: { files: context.state.files } };
  },
} satisfies ConversationNodeDefinition<UniverTurnState>;

/** Select a Turn-tail surface only when that Turn touches Univer documents. */
export function selectUniverTurn(owner: TurnTailOwnerProps): UniverTurnMatch | null {
  const data = owner.turn.data.get("univerTurn");
  if (data === undefined || data.files.length === 0) return null;
  return { turn: owner.turn.turn, files: data.files };
}

/** Whether an operation may deliberately open or restore the live viewer window. */
export function opensFloatingWindow(operation: UniverTurnOperation): boolean {
  if (operation.phase !== "succeeded") return false;
  if (operation.name === "new" || operation.name === "open" || operation.name === "unit") return true;
  if (operation.name === "worktree") {
    return operation.action === "create" || operation.action === "reopen" || operation.action === "ready";
  }
  return isWrite(operation);
}

/** Targets referenced anywhere in a session, used to restore floating-window intent. */
export function turnFilesOfSession(session: unknown, _cwd?: string): UniverTurnFile[] {
  if (session === null || typeof session !== "object") return [];
  const snapshot = session as { chat?: { timeline?: { turns?: ReadonlyMap<number, { data: ReadonlyMap<string, unknown> }> } } };
  const turns = snapshot.chat?.timeline?.turns;
  if (turns === undefined) return [];
  const files: UniverTurnFile[] = [];
  for (const turn of turns.values()) {
    const data = turn.data.get("univerTurn") as UniverTurnData | undefined;
    if (data !== undefined && data !== null) files.push(...data.files);
  }
  return mergeFiles(files);
}

/** Merge operations that resolve to the same document key. */
export function mergeFiles(files: readonly UniverTurnFile[]): UniverTurnFile[] {
  // Worktree and unit operations can carry an alias instead of the resource
  // id. Resolve those aliases first so one remote Unit always becomes one
  // card, even when the operations happened in different Turns.
  const worktreeResources = new Map<string, string>();
  const unitResources = new Map<string, string>();
  const localWorktrees = new Set<string>();
  const localUnits = new Map<string, string>();
  const localResources = new Map<string, string>();
  const mergedWorktrees = new Set<string>();
  for (const file of files) {
    for (const operation of file.operations) {
      if (operation.source === "worktree" && operation.worktreeId !== null) {
        localWorktrees.add(operation.worktreeId);
        if (operation.unitId !== null) localUnits.set(operation.unitId, `wt:${operation.worktreeId}`);
        if (operation.resourceId !== null) localResources.set(operation.resourceId, `wt:${operation.worktreeId}`);
      }
      if (operation.name === "worktree" && operation.action === "merge" && operation.worktreeId !== null) {
        mergedWorktrees.add(operation.worktreeId);
      }
      if (operation.resourceId !== null) {
        const resourceKey = `res:${operation.resourceId}`;
        if (operation.worktreeId !== null) worktreeResources.set(operation.worktreeId, resourceKey);
        if (operation.unitId !== null && operation.source !== "worktree") unitResources.set(operation.unitId, resourceKey);
      }
    }
  }
  const canonicalKey = (key: string): string => {
    if (key.startsWith("wt:")) {
      const worktreeId = key.slice(3);
      if (localWorktrees.has(worktreeId) && !mergedWorktrees.has(worktreeId)) return key;
      return worktreeResources.get(worktreeId) ?? key;
    }
    if (key.startsWith("unit:")) return localUnits.get(key.slice(5)) ?? unitResources.get(key.slice(5)) ?? key;
    if (key.startsWith("res:")) return localResources.get(key.slice(4)) ?? key;
    return key;
  };
  const unique = new Map<string, UniverTurnFile>();
  for (const target of files) {
    let remappedKey = canonicalKey(target.docKey);
    if (!isViewerDocKey(remappedKey)) {
      for (const operation of target.operations) {
        const operationKey = operationCanonicalKey(operation, canonicalKey);
        if (isViewerDocKey(operationKey)) {
          remappedKey = operationKey;
          break;
        }
      }
    }
    const remappedOperations = target.operations.map((operation) => {
      const operationKey = operationCanonicalKey(operation, canonicalKey);
      return operationKey === operation.docKey ? operation : { ...operation, docKey: operationKey };
    });
    const previous = unique.get(remappedKey);
    unique.set(remappedKey, {
      docKey: remappedKey,
      operations: [...previous?.operations ?? [], ...remappedOperations],
    });
  }
  return [...unique.values()];
}

function operationCanonicalKey(
  operation: UniverTurnOperation,
  canonicalKey: (key: string) => string,
): string {
  if (operation.source === "worktree" && operation.worktreeId !== null) {
    return canonicalKey(`wt:${operation.worktreeId}`);
  }
  if (operation.unitId !== null) {
    const unitKey = canonicalKey(`unit:${operation.unitId}`);
    if (isViewerDocKey(unitKey)) return unitKey;
  }
  if (operation.resourceId !== null) return canonicalKey(`res:${operation.resourceId}`);
  if (operation.worktreeId !== null) return canonicalKey(`wt:${operation.worktreeId}`);
  return operation.docKey;
}

/** Reduce operation semantics without allowing later reads to erase lifecycle transitions. */
export function outcomeOfTurnFile(target: UniverTurnFile): UniverTurnOutcome {
  let primaryWorktreeId: string | null = null;
  let lifecycle: UniverTurnLifecycle = "unchanged";
  let preferredUnitId: string | null = null;
  let preferredUnitType: string | null = null;
  let preferredLabel: string | null = null;
  let readOnly = false;
  let changedContent = false;
  for (const operation of target.operations) {
    if (operation.phase !== "succeeded") continue;
    if (operation.label !== null) preferredLabel = operation.label;
    if (operation.unitId !== null) preferredUnitId = operation.unitId;
    if (operation.unitType !== null) preferredUnitType = operation.unitType;
    if (operation.name === "new") {
      lifecycle = "trunk";
      primaryWorktreeId = null;
      changedContent = true;
      continue;
    }
    if (operation.name === "worktree") {
      if (operation.action === "create" || operation.action === "reopen") {
        primaryWorktreeId = operation.worktreeId;
        lifecycle = "draft";
      } else if (operation.action === "ready") {
        primaryWorktreeId = operation.worktreeId;
        lifecycle = "ready";
      } else if (operation.action === "merge") {
        primaryWorktreeId = operation.worktreeId;
        lifecycle = "merged";
        readOnly = true;
      } else if (operation.action === "discard") {
        primaryWorktreeId = operation.worktreeId;
        lifecycle = "discarded";
        readOnly = true;
      }
      continue;
    }
    if (operation.name === "unit") {
      if (operation.action === "create") {
        primaryWorktreeId = operation.worktreeId;
        lifecycle = "draft";
        changedContent = true;
      }
      continue;
    }
    if (isWrite(operation)) {
      changedContent = true;
      if (lifecycle === "unchanged" || lifecycle === "trunk" || lifecycle === "draft") {
        primaryWorktreeId = operation.worktreeId;
        lifecycle = operation.worktreeId === null ? "trunk" : "draft";
      }
      continue;
    }
    if (operation.name === "open") readOnly = operation.readOnly;
    if (primaryWorktreeId === null && operation.worktreeId !== null) primaryWorktreeId = operation.worktreeId;
  }
  return { primaryWorktreeId, lifecycle, preferredUnitId, preferredUnitType, preferredLabel, readOnly, changedContent };
}

/** The latest Turn that touched each logical Unit, for historical card folding. */
export function latestUnitTurns(session: unknown): Map<string, number> {
  const latest = new Map<string, number>();
  const aliases = collectUnitAliases(session);
  const turns = timelineTurns(session);
  if (turns === undefined) return latest;
  for (const [turnNumber, turn] of turns) {
    const data = turn.data.get("univerTurn") as UniverTurnData | undefined;
    if (data === undefined || data === null) continue;
    for (const file of mergeFiles(data.files)) {
      latest.set(unitIdentityOfFile(file, aliases), turnNumber);
    }
  }
  return latest;
}

/** Resolve the same logical Unit key used by {@link latestUnitTurns}. */
export function unitIdentityOfTurnFile(file: UniverTurnFile, session: unknown): string {
  return unitIdentityOfFile(file, collectUnitAliases(session));
}

/** Kept for callers that need worktree-specific lifecycle folding. */
export function latestWorktreeTurns(session: unknown): Map<string, number> {
  const latest = new Map<string, number>();
  if (session === null || typeof session !== "object") return latest;
  const snapshot = session as { chat?: { timeline?: { turns?: ReadonlyMap<number, { data: ReadonlyMap<string, unknown> }> } } };
  const turns = snapshot.chat?.timeline?.turns;
  if (turns === undefined) return latest;
  for (const [turnNumber, turn] of turns) {
    const data = turn.data.get("univerTurn") as UniverTurnData | undefined;
    if (data === undefined || data === null) continue;
    for (const file of data.files) {
      for (const operation of file.operations) {
        if (operation.worktreeId !== null) latest.set(operation.worktreeId, turnNumber);
      }
    }
  }
  return latest;
}

interface UnitAliases {
  readonly byUnitId: Map<string, string>;
  readonly byWorktreeId: Map<string, string>;
  readonly localUnitIds: Set<string>;
  readonly localWorktreeIds: Set<string>;
}

function timelineTurns(session: unknown): ReadonlyMap<number, { data: ReadonlyMap<string, unknown> }> | undefined {
  if (session === null || typeof session !== "object") return undefined;
  const snapshot = session as { chat?: { timeline?: { turns?: ReadonlyMap<number, { data: ReadonlyMap<string, unknown> }> } } };
  return snapshot.chat?.timeline?.turns;
}

function collectUnitAliases(session: unknown): UnitAliases {
  const byUnitId = new Map<string, string>();
  const byWorktreeId = new Map<string, string>();
  const localUnitIds = new Set<string>();
  const localWorktreeIds = new Set<string>();
  const turns = timelineTurns(session);
  if (turns === undefined) return { byUnitId, byWorktreeId, localUnitIds, localWorktreeIds };
  // First collect authoritative resource identities. Later turns often only
  // carry unitId/worktreeId, so these aliases let them fold into the same card.
  for (const turn of turns.values()) {
    const data = turn.data.get("univerTurn") as UniverTurnData | undefined;
    if (data === undefined || data === null) continue;
    for (const file of data.files) {
      for (const operation of file.operations) {
        if (operation.source === "worktree") {
          if (operation.unitId !== null) localUnitIds.add(operation.unitId);
          if (operation.worktreeId !== null) localWorktreeIds.add(operation.worktreeId);
        }
        if (operation.resourceId === null) continue;
        const identity = `res:${operation.resourceId}`;
        if (operation.source !== "worktree") {
          if (operation.unitId !== null) byUnitId.set(operation.unitId, identity);
          if (operation.worktreeId !== null) byWorktreeId.set(operation.worktreeId, identity);
        }
      }
    }
  }
  return { byUnitId, byWorktreeId, localUnitIds, localWorktreeIds };
}

function unitIdentityOfFile(file: UniverTurnFile, aliases: UnitAliases): string {
  for (const operation of file.operations) {
    if (operation.source === "worktree" && operation.worktreeId !== null) {
      return `wt:${operation.worktreeId}`;
    }
    if (operation.worktreeId !== null && aliases.localWorktreeIds.has(operation.worktreeId)) {
      return `wt:${operation.worktreeId}`;
    }
    if (operation.unitId !== null && aliases.localUnitIds.has(operation.unitId)) {
      return operation.worktreeId === null ? `unit:${operation.unitId}` : `wt:${operation.worktreeId}`;
    }
    if (operation.resourceId !== null) return `res:${operation.resourceId}`;
    if (operation.unitId !== null) {
      const identity = aliases.byUnitId.get(operation.unitId);
      if (identity !== undefined) return identity;
      return `unit:${operation.unitId}`;
    }
    if (operation.worktreeId !== null) {
      const identity = aliases.byWorktreeId.get(operation.worktreeId);
      if (identity !== undefined) return identity;
    }
  }
  return `doc:${file.docKey}`;
}

function addCall(state: UniverTurnState, data: SessionEvent<"tool/call">["data"]): UniverTurnState {
  const name = operationName(data.name);
  if (name === null) return state;
  const args = parseRecord(data.arguments);
  if (args === null) return state;
  const action = typeof args.action === "string" ? args.action : null;
  const unitId = typeof args.unitId === "string" ? args.unitId : null;
  const resourceId = typeof args.resourceId === "string" ? args.resourceId : null;
  const label = typeof args.name === "string" ? args.name : null;
  const unitType = typeof args.unitType === "string" ? args.unitType : null;
  const worktreeId = typeof args.worktreeId === "string" ? args.worktreeId : null;
  const operation: UniverTurnOperation = {
    callId: data.callId,
    name,
    action,
    docKey: name === "worktree" && worktreeId !== null ? `wt:${worktreeId}` : docKeyOf(resourceId, unitId, label),
    label,
    unitType,
    resourceId,
    worktreeId,
    unitId,
    source: null,
    readOnly: false,
    phase: "pending",
  };
  return { ...state, files: appendOperation(state.files, operation) };
}

function applyResult(state: UniverTurnState, data: SessionEvent<"tool/result">["data"]): UniverTurnState {
  const callId = data.message.content[0].toolCallId;
  const structured = structuredResult(data);
  let matched: UniverTurnOperation | undefined;
  for (const file of state.files) {
    const operation = file.operations.find((entry) => entry.callId === callId);
    if (operation !== undefined) matched = operation;
  }
  if (matched === undefined && structured === null) return state;
  // Tool renderers return the structured value directly. Accept the wrapped
  // `{ result: ... }` form as well for callers that use that convention.
  const result = structured === null
    ? null
    : isRecord(structured.result) ? structured.result : structured;
  const open = result !== null && isRecord(result.resource) ? result.resource : null;
  const resourceId = fieldOf(result, "resourceId") ?? fieldOf(open, "id") ?? matched?.resourceId ?? null;
  const unitId = fieldOf(result, "unitId") ?? fieldOf(open, "unitId") ?? matched?.unitId ?? null;
  const unitType = fieldOf(result, "unitType") ?? fieldOf(open, "unitType") ?? matched?.unitType ?? null;
  const label = fieldOf(result, "name") ?? fieldOf(open, "name") ?? matched?.label ?? null;
  const worktreeId = fieldOf(result, "worktreeId") ?? fieldOf(result, "id") ?? matched?.worktreeId ?? null;
  const unit = result !== null && isRecord(result.unit) ? result.unit : null;
  const source = sourceOf(result) ?? sourceOf(unit) ?? matched?.source ?? null;
  const name = matched?.name ?? "open";
  const operation: UniverTurnOperation = {
    callId,
    name,
    action: fieldOf(result, "action") ?? matched?.action ?? null,
    docKey: name === "worktree" && worktreeId !== null
      ? `wt:${worktreeId}`
      : source === "worktree" && worktreeId !== null
        ? `wt:${worktreeId}`
      : resourceId !== null ? `res:${resourceId}` : matched?.docKey ?? docKeyOf(null, unitId, label),
    label,
    unitType,
    resourceId,
    worktreeId,
    unitId,
    ...(source === null ? {} : { source }),
    readOnly: fieldOf(result, "editorMode") === "readOnly" || fieldOf(open, "editorMode") === "readOnly",
    phase: data.error === undefined && data.message.content[0].isError !== true ? "succeeded" : "failed",
  };
  const withoutCall = state.files.flatMap((entry) => {
    const operations = entry.operations.filter((candidate) => candidate.callId !== callId);
    return operations.length === 0 ? [] : [{ ...entry, operations }];
  });
  return { ...state, files: appendOperation(withoutCall, operation) };
}

function appendOperation(files: readonly UniverTurnFile[], operation: UniverTurnOperation): UniverTurnFile[] {
  const next = [...files];
  const index = next.findIndex((entry) => entry.docKey === operation.docKey);
  if (index === -1) next.push({ docKey: operation.docKey, operations: [operation] });
  else {
    const previous = next[index];
    if (previous !== undefined) next[index] = { ...previous, operations: [...previous.operations, operation] };
  }
  return next;
}

function structuredResult(data: SessionEvent<"tool/result">["data"]): Record<string, unknown> | null {
  const text = data.message.content[0].content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
  const firstBrace = text.indexOf("{");
  return firstBrace === -1 ? null : parseRecord(text.slice(firstBrace));
}

function operationName(name: string): UniverOperationName | null {
  if (!name.startsWith("univer_")) return null;
  const operation = name.slice("univer_".length);
  if (operation === "create" || operation === "new") return "new";
  if (operation === "open") return "open";
  if (operation === "status") return "status";
  if (operation === "unit") return "unit";
  if (operation === "inspect") return "inspect";
  if (operation === "edit" || operation === "execute") return "execute";
  if (operation === "import") return "import";
  if (operation === "export") return "export";
  if (operation === "worktree") return "worktree";
  return null;
}

function isWrite(operation: UniverTurnOperation): boolean {
  return operation.name === "execute" || operation.name === "import" || operation.name === "unit";
}

function docKeyOf(resourceId: string | null, unitId: string | null, label: string | null): string {
  if (resourceId !== null) return `res:${resourceId}`;
  if (unitId !== null) return `unit:${unitId}`;
  return `name:${label ?? ""}`;
}

function fieldOf(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function sourceOf(record: Record<string, unknown> | null): "trunk" | "worktree" | null {
  const value = record?.source;
  return value === "trunk" || value === "worktree" ? value : null;
}

function parseRecord(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
