/**
 * Worktree lifecycle and Unit contracts for the Workspace API.
 * @module dsh-univer-workspace-plugin/provider/worktree-api
 */

import type { WorkspaceHttpClient } from "./workspace-contract.ts";
import type {
  WorktreeCapabilities,
  WorktreeCreator,
  WorktreeStateView,
  WorktreeTeamSpace,
  WorktreeUnitView,
} from "../shared/state.ts";
import { WorkspaceApiError, readJson, stringField } from "./api-errors.ts";
import { jsonWithIdempotency, newIdempotencyKey } from "./resources-api.ts";

export type {
  WorktreeCapabilities,
  WorktreeCreator,
  WorktreeStateView,
  WorktreeTeamSpace,
  WorktreeUnitView,
};

export interface WorktreeSummary {
  readonly id: string;
  readonly name: string;
  readonly summary: string | null;
  readonly kind: "user" | "team";
  readonly teamSpace: WorktreeTeamSpace | null;
  readonly visibility: "private" | "space";
  readonly state: "draft" | "ready" | "merging" | "merged" | "discarded";
  readonly creator: WorktreeCreator;
  readonly unitCount: number;
  readonly processedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly capabilities: WorktreeCapabilities;
}

export function narrowWorktreeSummary(raw: unknown): WorktreeSummary {
  const record = (raw ?? {}) as Record<string, unknown>;
  // POST /worktrees returns the summary directly (201), while transition
  // endpoints wrap it as `{ worktree }`. Accept both forms; rejecting the
  // direct create response made every agent worktree appear malformed.
  const worktree = (
    record.worktree !== null && typeof record.worktree === "object" ? record.worktree : record
  ) as Record<string, unknown>;
  const id = typeof worktree.id === "string" ? worktree.id : undefined;
  const name = typeof worktree.name === "string" ? worktree.name : undefined;
  const state =
    worktree.state === "draft" ||
    worktree.state === "ready" ||
    worktree.state === "merging" ||
    worktree.state === "merged" ||
    worktree.state === "discarded"
      ? worktree.state
      : undefined;
  const summary =
    worktree.summary === null || typeof worktree.summary === "string"
      ? worktree.summary
      : undefined;
  const kind = worktree.kind === "user" || worktree.kind === "team" ? worktree.kind : undefined;
  const teamSpaceRaw = worktree.teamSpace;
  const teamSpace =
    teamSpaceRaw === null
      ? null
      : teamSpaceRaw !== null &&
          typeof teamSpaceRaw === "object" &&
          typeof (teamSpaceRaw as Record<string, unknown>).id === "string" &&
          (teamSpaceRaw as Record<string, unknown>).type === "team" &&
          typeof (teamSpaceRaw as Record<string, unknown>).name === "string"
        ? {
            id: (teamSpaceRaw as Record<string, unknown>).id as string,
            type: "team" as const,
            name: (teamSpaceRaw as Record<string, unknown>).name as string,
          }
        : undefined;
  const visibility =
    worktree.visibility === "private" || worktree.visibility === "space"
      ? worktree.visibility
      : undefined;
  const creatorRaw = worktree.creator;
  const creator =
    creatorRaw !== null &&
    typeof creatorRaw === "object" &&
    typeof (creatorRaw as Record<string, unknown>).id === "string" &&
    typeof (creatorRaw as Record<string, unknown>).username === "string" &&
    typeof (creatorRaw as Record<string, unknown>).displayName === "string" &&
    ((creatorRaw as Record<string, unknown>).avatarUrl === null ||
      typeof (creatorRaw as Record<string, unknown>).avatarUrl === "string")
      ? {
          id: (creatorRaw as Record<string, unknown>).id as string,
          username: (creatorRaw as Record<string, unknown>).username as string,
          displayName: (creatorRaw as Record<string, unknown>).displayName as string,
          avatarUrl: (creatorRaw as Record<string, unknown>).avatarUrl as string | null,
        }
      : undefined;
  const capabilitiesRaw = worktree.capabilities;
  const capability = (key: keyof WorktreeCapabilities): boolean | undefined => {
    if (capabilitiesRaw === null || typeof capabilitiesRaw !== "object") return undefined;
    const value = (capabilitiesRaw as Record<string, unknown>)[key];
    return typeof value === "boolean" ? value : undefined;
  };
  const capabilities = {
    review: capability("review"),
    editDraft: capability("editDraft"),
    addUnit: capability("addUnit"),
    changeVisibility: capability("changeVisibility"),
    markReady: capability("markReady"),
    reopen: capability("reopen"),
    merge: capability("merge"),
    discard: capability("discard"),
  };
  const unitCount =
    typeof worktree.unitCount === "number" &&
    Number.isSafeInteger(worktree.unitCount) &&
    worktree.unitCount >= 0
      ? worktree.unitCount
      : undefined;
  const processedAt =
    worktree.processedAt === null || typeof worktree.processedAt === "string"
      ? worktree.processedAt
      : undefined;
  const createdAt = typeof worktree.createdAt === "string" ? worktree.createdAt : undefined;
  const updatedAt = typeof worktree.updatedAt === "string" ? worktree.updatedAt : undefined;
  if (
    id === undefined ||
    name === undefined ||
    summary === undefined ||
    kind === undefined ||
    teamSpace === undefined ||
    visibility === undefined ||
    state === undefined ||
    creator === undefined ||
    unitCount === undefined ||
    processedAt === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    Object.values(capabilities).some((value) => value === undefined) ||
    (kind === "user" && (teamSpace !== null || visibility !== "private")) ||
    (kind === "team" && teamSpace === null)
  ) {
    throw new WorkspaceApiError(
      "workspace worktree returned a malformed summary",
      502,
      "MALFORMED_WORKTREE",
    );
  }
  return {
    id,
    name,
    summary,
    kind,
    teamSpace,
    visibility,
    state,
    creator,
    unitCount,
    processedAt,
    createdAt,
    updatedAt,
    capabilities: capabilities as WorktreeCapabilities,
  };
}

/** Create a User Worktree. */
export async function createWorktree(
  client: WorkspaceHttpClient,
  input: { name: string; summary: string | null },
): Promise<WorktreeSummary> {
  const raw = await readJson(
    await client.request(
      "/api/worktrees",
      jsonWithIdempotency({
        kind: "user",
        name: input.name,
        summary: input.summary,
      }),
    ),
    "worktree create",
  );
  return narrowWorktreeSummary(raw);
}

/** Add an existing trunk Resource to a Worktree and validate the mapped Unit. */
export async function addWorktreeTrunkUnit(
  client: WorkspaceHttpClient,
  worktreeId: string,
  resourceId: string,
): Promise<WorktreeUnitDescriptor> {
  const raw = await readJson(
    await client.request(
      `/api/worktrees/${encodeURIComponent(worktreeId)}/units`,
      jsonWithIdempotency({ source: "trunk", resourceId }),
    ),
    "worktree add unit",
  );
  const unit = narrowWorktreeUnit((raw as Record<string, unknown>).unit);
  if (unit.source !== "trunk" || unit.resourceId !== resourceId || unit.target !== null) {
    throw new WorkspaceApiError(
      "workspace Worktree response does not match the requested trunk Resource",
      502,
      "WORKTREE_UNIT_RESULT_MISMATCH",
    );
  }
  return unit;
}

/** A Worktree-local Unit creation request. */
export interface CreateWorktreeLocalUnitInput {
  readonly worktreeId: string;
  readonly name: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly targetSpaceId: string;
  readonly targetParentNodeId: string | null;
  readonly initialData?: Readonly<Record<string, unknown>>;
  /** Reuse this key when the caller needs idempotent replay across retries. */
  readonly idempotencyKey?: string;
}

/** The complete Unit descriptor returned by the Worktree contract. */
export interface WorktreeUnitDescriptor {
  readonly unitId: string;
  readonly resourceId: string;
  readonly nodeId: string;
  readonly source: "trunk" | "worktree";
  readonly name: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly target: { readonly spaceId: string; readonly parentNodeId: string | null } | null;
  readonly draftHeadRevision: number;
  readonly change: "modified" | "added" | "deleted" | "unchanged";
  readonly mergeResult: "pending" | "merged" | "unchanged" | "conflict" | "failed";
  readonly activationState:
    | "notApplicable"
    | "waitingForMerge"
    | "pending"
    | "completed"
    | "failed"
    | "discarded";
}

const WORKTREE_UNIT_TYPES = ["sheet", "doc", "slide", "board", "base"] as const;
const WORKTREE_UNIT_CHANGES = ["modified", "added", "deleted", "unchanged"] as const;
const WORKTREE_MERGE_RESULTS = ["pending", "merged", "unchanged", "conflict", "failed"] as const;
const WORKTREE_ACTIVATION_STATES = [
  "notApplicable",
  "waitingForMerge",
  "pending",
  "completed",
  "failed",
  "discarded",
] as const;

function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

/** Narrow the complete `/api/worktrees/{id}/units` Unit descriptor. */
export function narrowWorktreeUnit(raw: unknown): WorktreeUnitDescriptor {
  const record = (raw ?? {}) as Record<string, unknown>;
  const unitId = stringField(record.unitId);
  const resourceId = stringField(record.resourceId);
  const nodeId = stringField(record.nodeId);
  const source =
    record.source === "trunk" || record.source === "worktree" ? record.source : undefined;
  const name = stringField(record.name);
  const unitType = oneOf(record.unitType, WORKTREE_UNIT_TYPES);
  const targetRaw = record.target;
  let target: WorktreeUnitDescriptor["target"] | undefined;
  if (targetRaw === null) {
    target = null;
  } else if (targetRaw !== null && typeof targetRaw === "object") {
    const targetRecord = targetRaw as Record<string, unknown>;
    const spaceId = stringField(targetRecord.spaceId);
    const parentNodeId =
      targetRecord.parentNodeId === null ? null : stringField(targetRecord.parentNodeId);
    if (spaceId === undefined || parentNodeId === undefined) {
      throw new WorkspaceApiError(
        "workspace worktree unit returned a malformed target",
        502,
        "MALFORMED_WORKTREE_UNIT",
      );
    }
    target = { spaceId, parentNodeId };
  } else {
    target = undefined;
  }
  const draftHeadRevision =
    typeof record.draftHeadRevision === "number" &&
    Number.isInteger(record.draftHeadRevision) &&
    record.draftHeadRevision >= 0
      ? record.draftHeadRevision
      : undefined;
  const change = oneOf(record.change, WORKTREE_UNIT_CHANGES);
  const mergeResult = oneOf(record.mergeResult, WORKTREE_MERGE_RESULTS);
  const activationState = oneOf(record.activationState, WORKTREE_ACTIVATION_STATES);
  if (
    unitId === undefined ||
    resourceId === undefined ||
    nodeId === undefined ||
    source === undefined ||
    name === undefined ||
    unitType === undefined ||
    target === undefined ||
    draftHeadRevision === undefined ||
    change === undefined ||
    mergeResult === undefined ||
    activationState === undefined
  ) {
    throw new WorkspaceApiError(
      "workspace worktree unit returned a malformed descriptor",
      502,
      "MALFORMED_WORKTREE_UNIT",
    );
  }
  if ((source === "trunk" && target !== null) || (source === "worktree" && target === null)) {
    throw new WorkspaceApiError(
      "workspace worktree unit source and target do not match",
      502,
      "MALFORMED_WORKTREE_UNIT",
    );
  }
  return {
    unitId,
    resourceId,
    nodeId,
    source,
    name,
    unitType,
    target,
    draftHeadRevision,
    change,
    mergeResult,
    activationState,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface OperationView {
  readonly id: string;
  readonly state: "pending" | "completed" | "failed";
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

function narrowOperation(raw: unknown): OperationView {
  const record = (raw ?? {}) as Record<string, unknown>;
  const operation =
    record.operation !== null && typeof record.operation === "object"
      ? (record.operation as Record<string, unknown>)
      : record;
  const id = stringField(operation.id);
  const state =
    operation.state === "pending" || operation.state === "completed" || operation.state === "failed"
      ? operation.state
      : undefined;
  const result =
    operation.result === null || operation.result === undefined
      ? null
      : operation.result !== null &&
          typeof operation.result === "object" &&
          !Array.isArray(operation.result)
        ? (operation.result as Readonly<Record<string, unknown>>)
        : undefined;
  const errorRaw = operation.error;
  const error =
    errorRaw === null || errorRaw === undefined
      ? null
      : errorRaw !== null &&
          typeof errorRaw === "object" &&
          typeof (errorRaw as Record<string, unknown>).code === "string" &&
          typeof (errorRaw as Record<string, unknown>).message === "string"
        ? {
            code: (errorRaw as Record<string, unknown>).code as string,
            message: (errorRaw as Record<string, unknown>).message as string,
          }
        : undefined;
  if (id === undefined || state === undefined || result === undefined || error === undefined) {
    throw new WorkspaceApiError(
      "workspace operation returned a malformed descriptor",
      502,
      "MALFORMED_OPERATION",
    );
  }
  return { id, state, result, error };
}

const OPERATION_ATTEMPT_LIMIT = 30;
const OPERATION_DEFAULT_DELAY_MS = 500;

async function awaitOperation(
  client: WorkspaceHttpClient,
  operationId: string,
): Promise<OperationView> {
  for (let attempt = 0; attempt < OPERATION_ATTEMPT_LIMIT; attempt += 1) {
    const response = await client.request(`/api/operations/${encodeURIComponent(operationId)}`);
    const operation = narrowOperation(await readJson(response, "operation status"));
    if (operation.state === "completed") return operation;
    if (operation.state === "failed") {
      throw new WorkspaceApiError(
        operation.error?.message ?? "workspace operation failed",
        502,
        operation.error?.code ?? "WORKSPACE_OPERATION_FAILED",
      );
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1_000, 5_000)
        : OPERATION_DEFAULT_DELAY_MS;
    await delay(delayMs);
  }
  throw new WorkspaceApiError("workspace operation is still pending", 504, "OPERATION_PENDING");
}

async function worktreeDetail(client: WorkspaceHttpClient, worktreeId: string): Promise<unknown> {
  return await readJson(
    await client.request(`/api/worktrees/${encodeURIComponent(worktreeId)}`),
    "worktree detail",
  );
}

/** Fetch and validate one complete Worktree detail from Workspace. */
export async function getWorktreeDetail(
  client: WorkspaceHttpClient,
  worktreeId: string,
): Promise<WorktreeStateView> {
  return narrowWorktreeDetail(await worktreeDetail(client, worktreeId));
}

/** Convert a validated detail back to the summary shape used by tools. */
export function worktreeSummaryFromDetail(detail: WorktreeStateView): WorktreeSummary {
  return {
    id: detail.worktreeId,
    name: detail.name,
    summary: detail.summary,
    kind: detail.kind,
    teamSpace: detail.teamSpace,
    visibility: detail.visibility,
    state: detail.status,
    creator: detail.creator,
    unitCount: detail.unitCount,
    processedAt: detail.processedAt,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    capabilities: detail.capabilities,
  };
}

/**
 * Create a Unit owned by a Worktree. This is the real Workspace equivalent of
 * Office's `univer_unit create`; the product contract has no Unit-delete
 * endpoint, so this function deliberately exposes creation only.
 */
export async function createWorktreeLocalUnit(
  client: WorkspaceHttpClient,
  input: CreateWorktreeLocalUnitInput,
): Promise<WorktreeUnitDescriptor> {
  const headers = {
    "content-type": "application/json",
    "Idempotency-Key": input.idempotencyKey ?? newIdempotencyKey(),
  };
  const body = JSON.stringify({
    source: "worktree",
    name: input.name,
    unitType: input.unitType,
    targetSpaceId: input.targetSpaceId,
    targetParentNodeId: input.targetParentNodeId,
    ...(input.initialData === undefined ? {} : { initialData: input.initialData }),
  });
  let response = await client.request(
    `/api/worktrees/${encodeURIComponent(input.worktreeId)}/units`,
    { method: "POST", headers, body },
  );
  if (response.status === 202) {
    const operation = narrowOperation(await readJson(response, "worktree unit create"));
    const completed =
      operation.state === "pending" ? await awaitOperation(client, operation.id) : operation;
    if (completed.state !== "completed") {
      throw new WorkspaceApiError(
        "workspace worktree unit create did not complete",
        502,
        "WORKTREE_UNIT_CREATE_FAILED",
      );
    }
    response = await client.request(`/api/worktrees/${encodeURIComponent(input.worktreeId)}`);
    const detail = await readJson(response, "worktree detail");
    const unitsRaw = (
      (detail as Record<string, unknown>).worktree as Record<string, unknown> | undefined
    )?.units;
    const units = Array.isArray(unitsRaw) ? unitsRaw : [];
    const resultUnitId =
      typeof completed.result?.unitId === "string" ? completed.result.unitId : undefined;
    const rawUnit = units.find((entry) => {
      if (entry === null || typeof entry !== "object") return false;
      const candidate = entry as Record<string, unknown>;
      return resultUnitId !== undefined
        ? candidate.unitId === resultUnitId
        : candidate.name === input.name && candidate.unitType === input.unitType;
    });
    if (rawUnit === undefined) {
      throw new WorkspaceApiError(
        "workspace operation completed without a Worktree Unit",
        502,
        "MALFORMED_WORKTREE_UNIT",
      );
    }
    const unit = narrowWorktreeUnit(rawUnit);
    assertCreatedLocalUnit(unit, input);
    return unit;
  }
  const raw = await readJson(response, "worktree unit create");
  const unit = (raw as Record<string, unknown>).unit;
  const narrowed = narrowWorktreeUnit(unit);
  assertCreatedLocalUnit(narrowed, input);
  return narrowed;
}

/** Reject a successful response that silently points at another Unit/target. */
function assertCreatedLocalUnit(
  unit: WorktreeUnitDescriptor,
  input: CreateWorktreeLocalUnitInput,
): void {
  if (
    unit.source !== "worktree" ||
    unit.name !== input.name ||
    unit.unitType !== input.unitType ||
    unit.target?.spaceId !== input.targetSpaceId ||
    unit.target.parentNodeId !== input.targetParentNodeId
  ) {
    throw new WorkspaceApiError(
      "workspace Worktree Unit response does not match the requested Unit",
      502,
      "WORKTREE_UNIT_RESULT_MISMATCH",
    );
  }
}

/** A Worktree Unit open descriptor. */
export interface OpenedWorktreeUnit {
  readonly unitId: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly editorMode: "edit" | "readOnly";
  readonly collaborationScope: {
    readonly kind: "trunk" | "worktree" | "mergePreview";
    readonly worktreeId?: string;
  };
}

function narrowWorktreeUnitOpen(raw: unknown): OpenedWorktreeUnit {
  const record = (raw ?? {}) as {
    unit?: Record<string, unknown>;
    collaborationScope?: Record<string, unknown>;
  };
  const unit = record.unit ?? {};
  const unitId = typeof unit.unitId === "string" ? unit.unitId : undefined;
  const unitType =
    unit.unitType === "sheet" ||
    unit.unitType === "doc" ||
    unit.unitType === "slide" ||
    unit.unitType === "board" ||
    unit.unitType === "base"
      ? unit.unitType
      : undefined;
  const scope = record.collaborationScope ?? {};
  const kind =
    scope.kind === "worktree" || scope.kind === "mergePreview" || scope.kind === "trunk"
      ? scope.kind
      : "worktree";
  if (unitId === undefined || unitType === undefined) {
    throw new WorkspaceApiError(
      "workspace worktree unit open returned a malformed descriptor",
      502,
      "MALFORMED_WORKTREE_UNIT",
    );
  }
  return {
    unitId,
    unitType,
    editorMode: unit.editorMode === "readOnly" ? "readOnly" : "edit",
    collaborationScope: {
      kind,
      ...(scope.worktreeId === undefined ? {} : { worktreeId: String(scope.worktreeId) }),
    },
  };
}

/** Open a Worktree Unit in a given mode. */
export async function openWorktreeUnit(
  client: WorkspaceHttpClient,
  worktreeId: string,
  unitId: string,
  mode: "draft" | "trunk" | "mergePreview",
): Promise<OpenedWorktreeUnit> {
  const raw = await readJson(
    await client.request(
      `/api/worktrees/${encodeURIComponent(worktreeId)}/units/${encodeURIComponent(unitId)}/open`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      },
    ),
    "worktree unit open",
  );
  return narrowWorktreeUnitOpen(raw);
}

/** Mark a Worktree ready to merge. */
export async function markWorktreeReady(
  client: WorkspaceHttpClient,
  worktreeId: string,
): Promise<WorktreeSummary> {
  const raw = await readJson(
    await client.request(`/api/worktrees/${encodeURIComponent(worktreeId)}/ready`, {
      method: "POST",
    }),
    "worktree ready",
  );
  return narrowWorktreeSummary(raw);
}

/** Discard a Worktree. */
export async function discardWorktree(
  client: WorkspaceHttpClient,
  worktreeId: string,
): Promise<WorktreeSummary> {
  const raw = await readJson(
    await client.request(
      `/api/worktrees/${encodeURIComponent(worktreeId)}/discard`,
      jsonWithIdempotency({}),
    ),
    "worktree discard",
  );
  return narrowWorktreeSummary(raw);
}

/** Merge a Worktree. */
export async function mergeWorktree(
  client: WorkspaceHttpClient,
  worktreeId: string,
): Promise<WorktreeSummary> {
  const raw = await readJson(
    await client.request(
      `/api/worktrees/${encodeURIComponent(worktreeId)}/merge`,
      jsonWithIdempotency({}),
    ),
    "worktree merge",
  );
  return narrowWorktreeSummary(raw);
}

/** Reopen a ready Worktree back to draft. */
export async function reopenWorktree(
  client: WorkspaceHttpClient,
  worktreeId: string,
): Promise<WorktreeSummary> {
  const raw = await readJson(
    await client.request(
      `/api/worktrees/${encodeURIComponent(worktreeId)}/reopen`,
      jsonWithIdempotency({}),
    ),
    "worktree reopen",
  );
  return narrowWorktreeSummary(raw);
}

export function narrowWorktreeDetail(raw: unknown): WorktreeStateView {
  const record = (raw ?? {}) as { worktree?: unknown };
  if (record.worktree === null || typeof record.worktree !== "object") {
    throw new WorkspaceApiError(
      "workspace worktree detail returned a malformed Unit list",
      502,
      "MALFORMED_WORKTREE_UNIT",
    );
  }
  const worktree = record.worktree as Record<string, unknown>;
  const summary = narrowWorktreeSummary(raw);
  if (!Array.isArray(worktree.units)) {
    throw new WorkspaceApiError(
      "workspace worktree detail returned a malformed Unit list",
      502,
      "MALFORMED_WORKTREE_UNIT",
    );
  }
  const rawUnits = worktree.units;
  const units: WorktreeUnitView[] = [];
  for (const entry of rawUnits) {
    if (entry === null || typeof entry !== "object") {
      throw new WorkspaceApiError(
        "workspace worktree detail contains a malformed Unit",
        502,
        "MALFORMED_WORKTREE_UNIT",
      );
    }
    const parsed = narrowWorktreeUnit(entry);
    units.push({
      unitId: parsed.unitId,
      resourceId: parsed.resourceId,
      nodeId: parsed.nodeId,
      name: parsed.name,
      unitType: parsed.unitType,
      source: parsed.source,
      target: parsed.target,
      kind: parsed.change,
      draftHeadRevision: parsed.draftHeadRevision,
      mergeResult: parsed.mergeResult,
      activationState: parsed.activationState,
    });
  }
  return {
    worktreeId: summary.id,
    name: summary.name,
    status: summary.state,
    summary: summary.summary,
    kind: summary.kind,
    teamSpace: summary.teamSpace,
    visibility: summary.visibility,
    creator: summary.creator,
    unitCount: summary.unitCount,
    processedAt: summary.processedAt,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    capabilities: summary.capabilities,
    units,
  };
}

/** List the current User's Worktree ids in one product lifecycle scope. */
async function listWorktreeIds(
  client: WorkspaceHttpClient,
  scope: "active" | "processed",
): Promise<readonly string[]> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ scope, limit: "50" });
    if (cursor !== undefined) query.set("cursor", cursor);
    const raw = await readJson(
      await client.request(`/api/worktrees?${query.toString()}`),
      "worktree list",
    );
    const record = (raw ?? {}) as { items?: unknown; nextCursor?: unknown };
    if (!Array.isArray(record.items)) {
      throw new WorkspaceApiError(
        "workspace worktree list returned no items array",
        502,
        "MALFORMED_WORKTREES",
      );
    }
    for (const entry of record.items) {
      const id = stringField((entry as Record<string, unknown> | null)?.id);
      if (id === undefined) {
        throw new WorkspaceApiError(
          "workspace worktree list contains a malformed item",
          502,
          "MALFORMED_WORKTREES",
        );
      }
      ids.add(id);
    }
    if (record.nextCursor === null || record.nextCursor === undefined) break;
    if (typeof record.nextCursor !== "string" || record.nextCursor === cursor) {
      throw new WorkspaceApiError(
        "workspace worktree list returned an invalid nextCursor",
        502,
        "MALFORMED_WORKTREES",
      );
    }
    cursor = record.nextCursor;
  }
  return [...ids];
}

async function loadWorktrees(
  client: WorkspaceHttpClient,
  ids: readonly string[],
): Promise<readonly WorktreeStateView[]> {
  const worktrees: WorktreeStateView[] = [];
  for (const id of ids) worktrees.push(await getWorktreeDetail(client, id));
  return worktrees;
}

/** List the current User's active Worktrees with their changed units. */
export async function listActiveWorktrees(
  client: WorkspaceHttpClient,
): Promise<readonly WorktreeStateView[]> {
  return await loadWorktrees(client, await listWorktreeIds(client, "active"));
}

/**
 * Review state must include completed Worktrees as well as drafts. The
 * conversation can outlive a merge/discard transition; dropping processed
 * ids makes its historical card look "unavailable" even though the product
 * still owns the Worktree and its units.
 */
export async function listReviewWorktrees(
  client: WorkspaceHttpClient,
): Promise<readonly WorktreeStateView[]> {
  const [activeIds, processedIds] = await Promise.all([
    listWorktreeIds(client, "active"),
    listWorktreeIds(client, "processed"),
  ]);
  return await loadWorktrees(client, [...new Set([...activeIds, ...processedIds])]);
}
