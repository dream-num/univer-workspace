import {
  createUniverCollaborationRuntimePool,
  type CollaborationCommitResult,
  type CollaborationRuntimeReadResult,
  type CollaborationUnitData,
  type UniverCollaborationRuntimeLease,
  type UniverCollaborationRuntimePool,
} from "@univer-cli/univer-collaboration-runtime-pool";
import type { CollaborationRuntimeValue } from "@univer-cli/univer-collaboration-runtime";
import type { IMutation } from "@univerjs/protocol";
import {
  createWorkspaceEmbeddedImageUploader,
  externalizeEmbeddedImages,
} from "./embedded-images.js";
import { measureCanonicalJson, type CanonicalJsonMeasurement } from "./canonical-json.js";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import { WorkspaceHttp } from "./http.js";
import {
  serializeWorkspaceRuntimeTarget,
  workspaceRuntimeKey,
  type WorkspaceRuntimeTarget,
} from "./runtime-target.js";
import type { WorkspaceContentWorkerInit } from "./content-worker.js";

export interface WorkspaceContentRuntimeOperations {
  executeAndCommit(input: {
    readonly code: string;
    readonly maxValueBytes?: number;
    readonly maxValueDepth?: number;
    readonly signal?: AbortSignal;
    readonly target: WorkspaceRuntimeTarget;
  }): Promise<WorkspaceContentRuntimeWriteResult>;
  executeRead(input: {
    readonly code: string;
    readonly signal?: AbortSignal;
    readonly target: WorkspaceRuntimeTarget;
  }): Promise<CollaborationRuntimeReadResult>;
  exportUnitData(input: {
    readonly maxValueBytes?: number;
    readonly maxValueDepth?: number;
    readonly signal?: AbortSignal;
    readonly target: WorkspaceRuntimeTarget;
  }): Promise<CollaborationUnitData>;
}

export type WorkspaceContentRuntimeWriteResult =
  | { readonly committed: false; readonly value: CollaborationRuntimeValue }
  | {
      readonly committed: true;
      readonly revision: number;
      readonly status: "committed";
      readonly value: CollaborationRuntimeValue;
    };

export interface WorkspaceContentRuntime extends WorkspaceContentRuntimeOperations {
  close(): Promise<void>;
}

export interface WorkspaceContentRuntimeOptions {
  readonly resolveCredential: (
    target: WorkspaceRuntimeTarget,
    signal?: AbortSignal,
  ) => Promise<string | undefined> | string | undefined;
  readonly resolveLicense: (signal?: AbortSignal) => Promise<string | undefined> | string | undefined;
  readonly workerEntry: string | URL;
}

interface AcquiredWorkspaceRuntime {
  readonly init: WorkspaceContentWorkerInit;
  readonly initEntry: Promise<WorkspaceContentWorkerInit>;
  readonly key: string;
  readonly lease: UniverCollaborationRuntimeLease;
}

export function createWorkspaceContentRuntime(
  options: WorkspaceContentRuntimeOptions,
): WorkspaceContentRuntime {
  const initByKey = new Map<string, Promise<WorkspaceContentWorkerInit>>();
  const operationByKey = new Map<string, Promise<void>>();
  const pool = createUniverCollaborationRuntimePool<WorkspaceContentWorkerInit>({
    entry: options.workerEntry,
    onEvent(event) {
      if (event.type === "destroy-start" || event.type === "instance-failed") {
        initByKey.delete(event.key);
      }
    },
  });
  let closed = false;
  let closePromise: Promise<void> | undefined;

  return {
    async close() {
      closed = true;
      closePromise ??= (async () => {
        await Promise.allSettled([...operationByKey.values()]);
        try {
          await pool.close();
        } finally {
          initByKey.clear();
        }
      })();
      await closePromise;
    },
    async executeRead(input) {
      return await runForRuntimeKey(operationByKey, input.target, input.signal, () => closed, async () => {
        const { lease } = await acquire(pool, initByKey, options, input.target, input.signal);
        try {
          await synchronize(lease, input.target, input.signal);
          input.signal?.throwIfAborted();
          const result = await lease.execute({ code: input.code, mode: "read" });
          input.signal?.throwIfAborted();
          return result;
        } finally {
          await lease.release();
        }
      });
    },
    async executeAndCommit(input) {
      if (input.target.scope.kind !== "worktree") {
        throw workspaceError(
          "WORKSPACE_TARGET_NOT_EDITABLE",
          "Execute requires a Worktree target",
        );
      }
      const worktreeId = input.target.scope.worktreeId;
      return await runForRuntimeKey(operationByKey, input.target, input.signal, () => closed, async () => {
        const { init, initEntry, key, lease } = await acquire(
          pool,
          initByKey,
          options,
          input.target,
          input.signal,
        );
        let reusable = false;
        try {
          await synchronize(lease, input.target, input.signal);
          input.signal?.throwIfAborted();
          const executed: unknown = await lease.execute({ code: input.code, mode: "write" });
          input.signal?.throwIfAborted();
          if (
            !isRecord(executed) ||
            !isMutationArray(executed["mutations"]) ||
            !("value" in executed)
          ) {
            throw workspaceError("WORKSPACE_RUNTIME_RESULT_INVALID", "Runtime result is invalid");
          }
          validateExecuteValue(
            executed["value"],
            input.maxValueBytes,
            input.maxValueDepth,
          );
          if (executed["mutations"].length === 0) {
            reusable = true;
            return { committed: false, value: executed["value"] as CollaborationRuntimeValue };
          }

          const http = new WorkspaceHttp({
            cookie: init.credential,
            origin: input.target.origin,
            role: "client",
          });
          let confirmedUploadCount = 0;
          const mutations = await externalizeEmbeddedImages({
            mutations: executed["mutations"],
            onUploadConfirmed: () => {
              confirmedUploadCount += 1;
            },
            ...(input.signal === undefined ? {} : { signal: input.signal }),
            target: input.target,
            unitId: input.target.unitId,
            uploader: createWorkspaceEmbeddedImageUploader(http),
            worktreeId,
          });
          throwForWriteCancellation(input.signal, confirmedUploadCount, input.target);
          try {
            await lease.replacePendingMutations(mutations);
          } catch (error) {
            if (input.signal?.aborted === true) {
              throwForWriteCancellation(input.signal, confirmedUploadCount, input.target);
            }
            throw error;
          }
          throwForWriteCancellation(input.signal, confirmedUploadCount, input.target);
          const committed = await commitStableChangeset(
            lease,
            input.target,
            input.signal,
            confirmedUploadCount,
          );
          reusable = true;
          return {
            committed: true,
            revision: committed.state.baseRevision,
            status: "committed",
            value: executed["value"] as CollaborationRuntimeValue,
          };
        } finally {
          if (reusable) await lease.release();
          else {
            if (initByKey.get(key) === initEntry) initByKey.delete(key);
            await lease.invalidate();
          }
        }
      });
    },
    async exportUnitData(input) {
      validateRuntimeBudget(input.maxValueBytes, input.maxValueDepth);
      return await runForRuntimeKey(operationByKey, input.target, input.signal, () => closed, async () => {
        const { lease } = await acquire(pool, initByKey, options, input.target, input.signal);
        try {
          await synchronize(lease, input.target, input.signal);
          input.signal?.throwIfAborted();
          const result = await lease.exportUnitData();
          input.signal?.throwIfAborted();
          validateRuntimeValue(result, input.maxValueBytes, input.maxValueDepth, "export-unit-data");
          input.signal?.throwIfAborted();
          return result;
        } finally {
          await lease.release();
        }
      });
    },
  };
}

async function runForRuntimeKey<T>(
  operationByKey: Map<string, Promise<void>>,
  target: WorkspaceRuntimeTarget,
  signal: AbortSignal | undefined,
  isClosed: () => boolean,
  operation: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  if (isClosed()) throw workspaceError("COLLABORATION_POOL_CLOSED", "Workspace content runtime is closed.");
  const key = workspaceRuntimeKey(target);
  const previous = operationByKey.get(key);
  let finish!: () => void;
  const current = new Promise<void>((resolve) => {
    finish = resolve;
  });
  operationByKey.set(key, current);
  if (previous !== undefined) await previous;
  try {
    signal?.throwIfAborted();
    if (isClosed()) throw workspaceError("COLLABORATION_POOL_CLOSED", "Workspace content runtime is closed.");
    return await operation();
  } finally {
    finish();
    if (operationByKey.get(key) === current) operationByKey.delete(key);
  }
}

async function acquire(
  pool: UniverCollaborationRuntimePool<WorkspaceContentWorkerInit>,
  initByKey: Map<string, Promise<WorkspaceContentWorkerInit>>,
  options: WorkspaceContentRuntimeOptions,
  target: WorkspaceRuntimeTarget,
  signal?: AbortSignal,
): Promise<AcquiredWorkspaceRuntime> {
  signal?.throwIfAborted();
  const key = workspaceRuntimeKey(target);
  let pending = initByKey.get(key);
  if (pending === undefined) {
    pending = resolveWorkerInit(options, target, signal);
    initByKey.set(key, pending);
    void pending.catch(() => {
      if (initByKey.get(key) === pending) initByKey.delete(key);
    });
  }
  const init = await pending;
  if (signal?.aborted === true) {
    if (initByKey.get(key) === pending) initByKey.delete(key);
    signal.throwIfAborted();
  }
  try {
    const lease = await pool.acquire({ init, key });
    if (signal?.aborted === true) {
      if (initByKey.get(key) === pending) initByKey.delete(key);
      await lease.invalidate();
      signal.throwIfAborted();
    }
    return { init, initEntry: pending, key, lease };
  } catch (error) {
    if (initByKey.get(key) === pending) initByKey.delete(key);
    signal?.throwIfAborted();
    throw error;
  }
}

async function commitStableChangeset(
  lease: UniverCollaborationRuntimeLease,
  target: WorkspaceRuntimeTarget,
  signal?: AbortSignal,
  confirmedUploadCount = 0,
): Promise<Extract<CollaborationCommitResult, { readonly status: "confirmed" }>> {
  let lastResult: CollaborationCommitResult | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted === true) {
      if (lastResult?.status === "retry" || lastResult?.status === "unknown") {
        throw commitUnknown(target, lastResult.changeset);
      }
      throwForWriteCancellation(signal, confirmedUploadCount, target);
    }
    let result: CollaborationCommitResult;
    try {
      result = await lease.commit();
    } catch (error) {
      if (signal?.aborted === true) throw commitUnknown(target);
      throw error;
    }
    lastResult = result;
    if (result.status === "confirmed") return result;
    if (result.status === "retry" || result.status === "unknown") {
      if (signal?.aborted === true) throw commitUnknown(target, result.changeset);
      continue;
    }
    if (result.status === "conflict") {
      throw workspaceError("WORKSPACE_RUNTIME_CONFLICT", result.conflict.message);
    }
    if (result.status === "pull-required") {
      throw workspaceError(
        "WORKSPACE_RUNTIME_PULL_REQUIRED",
        `Workspace advanced from revision ${String(result.baseRevision)} to ${String(result.knownHeadRevision)} during execute`,
      );
    }
    throw workspaceError("WORKSPACE_RUNTIME_COMMIT_INVALID", "Runtime discarded pending mutations");
  }
  const awaiting =
    lastResult !== undefined && (lastResult.status === "retry" || lastResult.status === "unknown")
      ? lastResult.changeset
      : undefined;
  const changeset = projectChangesetIdentity(awaiting);
  throw workspaceError(
    "workspace-submit-retry-exhausted",
    signal === undefined
      ? `Workspace changeset submit could not be confirmed after 3 attempts${awaiting === undefined ? "" : ` (sid ${awaiting.sid ?? "unknown"}, reqId ${String(awaiting.reqId ?? "unknown")})`}`
      : "Workspace changeset submit could not be confirmed after 3 attempts.",
    signal === undefined
      ? undefined
      : { target, ...(changeset === undefined ? {} : { changeset }) },
  );
}

async function resolveWorkerInit(
  options: WorkspaceContentRuntimeOptions,
  target: WorkspaceRuntimeTarget,
  signal?: AbortSignal,
): Promise<WorkspaceContentWorkerInit> {
  signal?.throwIfAborted();
  let credential: string | undefined;
  try {
    credential = signal === undefined
      ? await options.resolveCredential(target)
      : await options.resolveCredential(target, signal);
  } catch {
    signal?.throwIfAborted();
    throw workspaceError(
      "workspace-authentication-required",
      "Log in to the current Workspace origin first.",
    );
  }
  signal?.throwIfAborted();
  if (credential === undefined || credential.length === 0) {
    throw workspaceError(
      "workspace-authentication-required",
      "Log in to the current Workspace origin first.",
    );
  }
  let license: string | undefined;
  try {
    license = signal === undefined
      ? await options.resolveLicense()
      : await options.resolveLicense(signal);
  } catch {
    signal?.throwIfAborted();
    throw workspaceError("workspace-license-required", "Univer license is required.");
  }
  signal?.throwIfAborted();
  if (license === undefined || license.trim().length === 0) {
    throw workspaceError("workspace-license-required", "Univer license is required.");
  }
  return {
    credential,
    license,
    target: serializeWorkspaceRuntimeTarget(target),
  };
}

async function synchronize(
  lease: UniverCollaborationRuntimeLease,
  target: WorkspaceRuntimeTarget,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const before = await lease.getState();
  signal?.throwIfAborted();
  if (
    before.pendingMutationCount !== 0 ||
    before.awaitingChangeset !== null ||
    before.conflict !== null
  ) {
    throw workspaceError("WORKSPACE_RUNTIME_DIRTY", "Cached Workspace runtime is not reusable");
  }
  signal?.throwIfAborted();
  const pulled = await lease.pull();
  signal?.throwIfAborted();
  if (pulled.status === "conflict") {
    throw workspaceError("WORKSPACE_RUNTIME_CONFLICT", pulled.conflict.message);
  }
  if (pulled.state.baseRevision !== target.revision) {
    throw workspaceError(
      "workspace-result-mismatch",
      `Workspace runtime revision ${String(pulled.state.baseRevision)} does not match selected revision ${String(target.revision)}`,
    );
  }
}

function throwForWriteCancellation(
  signal: AbortSignal | undefined,
  confirmedUploadCount: number,
  target: WorkspaceRuntimeTarget,
): void {
  if (signal?.aborted !== true) return;
  if (confirmedUploadCount > 0) {
    throw workspaceError(
      "workspace-content-partial-side-effect",
      "Embedded image uploads were confirmed before content execution was cancelled.",
      {
        confirmedUploadCount,
        contentCommitted: false,
        effect: "embedded-image-upload",
        target,
      },
    );
  }
  signal.throwIfAborted();
}

function commitUnknown(target: WorkspaceRuntimeTarget, changeset?: unknown): Error {
  const identity = projectChangesetIdentity(changeset);
  return workspaceError(
    "workspace-result-unknown",
    "The Workspace content commit may have completed, but its result could not be confirmed.",
    { target, ...(identity === undefined ? {} : { changeset: identity }) },
  );
}

function validateExecuteValue(
  value: unknown,
  maxValueBytes: number | undefined,
  maxValueDepth: number | undefined,
): void {
  validateRuntimeValue(value, maxValueBytes, maxValueDepth, "execute-value");
}

function validateRuntimeValue(
  value: unknown,
  maxValueBytes: number | undefined,
  maxValueDepth: number | undefined,
  kind: "execute-value" | "export-unit-data",
): void {
  if (maxValueBytes === undefined && maxValueDepth === undefined) return;
  validateRuntimeBudget(maxValueBytes, maxValueDepth);
  let measurement: CanonicalJsonMeasurement;
  try {
    measurement = measureCanonicalJson(value);
  } catch {
    throw invalidExecuteValue();
  }
  if (maxValueDepth !== undefined && measurement.depth > maxValueDepth) {
    throw workspaceError(
      "workspace-content-limit-exceeded",
      "Workspace content runtime value exceeds its depth limit.",
      { actual: measurement.depth, kind: `${kind}-depth`, limit: maxValueDepth },
    );
  }
  if (maxValueBytes !== undefined && measurement.bytes > maxValueBytes) {
    throw workspaceError(
      "workspace-content-limit-exceeded",
      "Workspace content runtime value exceeds its byte limit.",
      { actual: measurement.bytes, kind: `${kind}-bytes`, limit: maxValueBytes },
    );
  }
}

function validateRuntimeBudget(
  maxValueBytes: number | undefined,
  maxValueDepth: number | undefined,
): void {
  if (
    (maxValueBytes !== undefined && (!Number.isSafeInteger(maxValueBytes) || maxValueBytes < 1))
    || (maxValueDepth !== undefined && (!Number.isSafeInteger(maxValueDepth) || maxValueDepth < 0))
  ) {
    throw workspaceError("WORKSPACE_RUNTIME_RESULT_INVALID", "Runtime value budget is invalid.");
  }
}

function projectChangesetIdentity(value: unknown): Record<string, number | string> | undefined {
  if (!isRecord(value)) return undefined;
  const projected: Record<string, number | string> = {};
  for (const key of ["baseRevision", "mutationCount", "reqId", "revision", "sid"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" || (typeof candidate === "number" && Number.isSafeInteger(candidate))) {
      projected[key] = candidate;
    }
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function invalidExecuteValue(): Error {
  return workspaceError("WORKSPACE_RUNTIME_RESULT_INVALID", "Runtime value is not lossless JSON.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMutationArray(value: unknown): value is readonly IMutation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (mutation) =>
        isRecord(mutation) &&
        typeof mutation["id"] === "string" &&
        typeof mutation["data"] === "string",
    )
  );
}
