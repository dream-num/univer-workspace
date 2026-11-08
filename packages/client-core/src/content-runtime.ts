import {
  createUniverCollaborationRuntimePool,
  UniverCollaborationRuntimePoolError,
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
import { workspaceError } from "./errors.js";
import { WorkspaceHttp } from "./http.js";
import {
  normalizeWorkspaceRuntimeOrigin,
  serializeWorkspaceRuntimeTarget,
  workspaceRuntimeKey,
  type WorkspaceRuntimeCaller,
  type WorkspaceRuntimeTarget,
} from "./runtime-target.js";
import type { WorkspaceContentWorkerInit } from "./content-worker.js";

export interface WorkspaceContentRuntimeObservation {
  readonly coldStart: boolean;
  readonly workerMs: number;
}

export interface WorkspaceContentRuntimeOperations {
  executeAndCommit(input: {
    readonly caller?: WorkspaceRuntimeCaller;
    readonly signal?: AbortSignal;
    readonly observe?: (observation: WorkspaceContentRuntimeObservation) => void;
    readonly code: string;
    readonly target: WorkspaceRuntimeTarget;
  }): Promise<WorkspaceContentRuntimeWriteResult>;
  executeRead(input: {
    readonly caller?: WorkspaceRuntimeCaller;
    readonly signal?: AbortSignal;
    readonly observe?: (observation: WorkspaceContentRuntimeObservation) => void;
    readonly code: string;
    readonly target: WorkspaceRuntimeTarget;
  }): Promise<CollaborationRuntimeReadResult>;
  exportUnitData(input: {
    readonly caller?: WorkspaceRuntimeCaller;
    readonly signal?: AbortSignal;
    readonly observe?: (observation: WorkspaceContentRuntimeObservation) => void;
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
    caller?: WorkspaceRuntimeCaller,
  ) => Promise<string | undefined> | string | undefined;
  readonly resolveLicense: (
    caller?: WorkspaceRuntimeCaller,
  ) => Promise<string | undefined> | string | undefined;
  readonly reuseWorker?: (
    created: WorkspaceRuntimeCaller | undefined,
    current: WorkspaceRuntimeCaller | undefined,
  ) => boolean;
  readonly workerEntry: string | URL;
  readonly transportOrigin?: string;
  readonly pool?: WorkspaceContentRuntimePoolOptions;
}

export interface WorkspaceContentRuntimePoolOptions {
  /** Exact worker child environment; unset inherits the host environment. */
  readonly env?: NodeJS.ProcessEnv;
  readonly idleTtlMs?: number;
  readonly maxWorkers?: number;
  readonly openTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  /**
   * Wait up to `timeoutMs` for one of `maxWorkers` runtime-key slots instead of failing at once
   * with the pool capacity error; unset keeps the immediate error. Requires `maxWorkers`.
   */
  readonly queue?: { readonly timeoutMs: number };
}

interface RuntimeSlotWaiter {
  readonly admit: () => void;
  readonly reject: (error: Error) => void;
}

/**
 * Runtime keys admitted to the pool, FIFO beyond `capacity`. Operations that join a key already
 * holding or awaiting a slot ride that slot and never take a second worker, so a continuously busy
 * key can delay other keys until their deadline. That is deliberate.
 */
interface RuntimeSlots {
  readonly capacity: number;
  closed: boolean;
  readonly timeoutMs: number;
  /** Admitted key to its count of unsettled operations; each key holds one slot. */
  readonly held: Map<string, number>;
  /** Waiting key to its waiters; Map insertion order is the FIFO. */
  readonly waiting: Map<string, RuntimeSlotWaiter[]>;
}

interface WorkerInit {
  readonly caller: WorkspaceRuntimeCaller | undefined;
  readonly pending: Promise<WorkspaceContentWorkerInit>;
}

interface AcquiredWorkspaceRuntime {
  readonly acquiredAt: number;
  readonly coldStart: boolean;
  readonly init: WorkspaceContentWorkerInit;
  readonly initEntry: WorkerInit;
  readonly key: string;
  readonly lease: UniverCollaborationRuntimeLease;
}

export function createWorkspaceContentRuntime(
  options: WorkspaceContentRuntimeOptions,
): WorkspaceContentRuntime {
  if (options.transportOrigin !== undefined) {
    normalizeWorkspaceRuntimeOrigin(options.transportOrigin);
  }
  const initByKey = new Map<string, WorkerInit>();
  const operationByKey = new Map<string, Promise<void>>();
  const poolOptions = options.pool;
  const slots = createRuntimeSlots(poolOptions);
  const cache = {
    ...(poolOptions?.idleTtlMs === undefined ? {} : { idleTtlMs: poolOptions.idleTtlMs }),
    ...(poolOptions?.maxWorkers === undefined ? {} : { maxEntries: poolOptions.maxWorkers }),
  };
  const pool = createUniverCollaborationRuntimePool<WorkspaceContentWorkerInit>({
    ...(Object.keys(cache).length === 0 ? {} : { cache }),
    entry: options.workerEntry,
    ...(poolOptions?.env === undefined ? {} : { env: poolOptions.env }),
    ...(poolOptions?.openTimeoutMs === undefined
      ? {}
      : { openTimeoutMs: poolOptions.openTimeoutMs }),
    ...(poolOptions?.operationTimeoutMs === undefined
      ? {}
      : { operationTimeoutMs: poolOptions.operationTimeoutMs }),
    onEvent(event) {
      if (event.type === "destroy-start" || event.type === "instance-failed") {
        initByKey.delete(event.key);
      }
    },
  });

  async function run<T>(
    input: {
      readonly caller?: WorkspaceRuntimeCaller;
      readonly target: WorkspaceRuntimeTarget;
      readonly signal?: AbortSignal;
    },
    operation: (deadline: number | undefined) => Promise<T>,
  ): Promise<T> {
    throwIfNotStartedAborted(input.signal);
    const key = workspaceRuntimeKey(input.target, input.caller);
    if (slots === undefined) {
      return await runForRuntimeKey(operationByKey, key, () => operation(undefined), input.signal);
    }
    const started = performance.now();
    await enterRuntimeSlot(slots, key, started + slots.timeoutMs, input.signal);
    // The capacity retry gets the slot budget left over, counted from when the operation leaves
    // the same-key chain, so waiting behind same-key operations is not charged as capacity wait.
    const remainingMs = slots.timeoutMs - (performance.now() - started);
    try {
      return await runForRuntimeKey(
        operationByKey,
        key,
        () => operation(performance.now() + remainingMs),
        input.signal,
      );
    } finally {
      leaveRuntimeSlot(slots, key);
    }
  }

  return {
    async close() {
      try {
        if (slots !== undefined) closeRuntimeSlots(slots);
        await pool.close();
      } finally {
        initByKey.clear();
      }
    },
    async executeRead(input) {
      return await run(input, async (deadline) => {
        const acquired = await acquire(
          pool,
          initByKey,
          options,
          input.target,
          input.caller,
          deadline,
          input.signal,
        );
        const { lease } = acquired;
        try {
          await synchronize(lease, input.target);
          return await inRuntimePhase("script", () =>
            lease.execute({ code: input.code, mode: "read" }),
          );
        } finally {
          try {
            await lease.release();
          } finally {
            observeRuntime(acquired, input.observe);
          }
        }
      });
    },
    async executeAndCommit(input) {
      if (input.target.scope.kind !== "worktree") {
        throw workspaceError("WORKSPACE_TARGET_NOT_EDITABLE", "Execute requires a Worktree target");
      }
      const worktreeId = input.target.scope.worktreeId;
      return await run(input, async (deadline) => {
        const acquired = await acquire(
          pool,
          initByKey,
          options,
          input.target,
          input.caller,
          deadline,
          input.signal,
        );
        const { init, initEntry, key, lease } = acquired;
        let reusable = false;
        try {
          await synchronize(lease, input.target);
          const executed: unknown = await inRuntimePhase("script", () =>
            lease.execute({ code: input.code, mode: "write" }),
          );
          if (
            !isRecord(executed) ||
            !isMutationArray(executed["mutations"]) ||
            !("value" in executed)
          ) {
            throw workspaceError("WORKSPACE_RUNTIME_RESULT_INVALID", "Runtime result is invalid");
          }
          if (executed["mutations"].length === 0) {
            reusable = true;
            return { committed: false, value: executed["value"] as CollaborationRuntimeValue };
          }

          const http = new WorkspaceHttp({
            cookie: init.credential,
            origin: input.target.origin,
            role: "client",
            ...(init.transportOrigin === undefined
              ? {}
              : { transportOrigin: init.transportOrigin }),
          });
          const mutations = await externalizeEmbeddedImages({
            mutations: executed["mutations"],
            unitId: input.target.unitId,
            uploader: createWorkspaceEmbeddedImageUploader(http),
            worktreeId,
          });
          await lease.replacePendingMutations(mutations);
          const committed = await inRuntimePhase("commit", () => commitStableChangeset(lease));
          reusable = true;
          return {
            committed: true,
            revision: committed.state.baseRevision,
            status: "committed",
            value: executed["value"] as CollaborationRuntimeValue,
          };
        } finally {
          try {
            if (reusable) await lease.release();
            else {
              if (initByKey.get(key) === initEntry) initByKey.delete(key);
              await lease.invalidate();
            }
          } finally {
            observeRuntime(acquired, input.observe);
          }
        }
      });
    },
    async exportUnitData(input) {
      return await run(input, async (deadline) => {
        const acquired = await acquire(
          pool,
          initByKey,
          options,
          input.target,
          input.caller,
          deadline,
          input.signal,
        );
        const { lease } = acquired;
        try {
          await synchronize(lease, input.target);
          return await lease.exportUnitData();
        } finally {
          try {
            await lease.release();
          } finally {
            observeRuntime(acquired, input.observe);
          }
        }
      });
    },
  };
}

function observeRuntime(
  acquired: AcquiredWorkspaceRuntime,
  observe: ((observation: WorkspaceContentRuntimeObservation) => void) | undefined,
): void {
  try {
    observe?.({ coldStart: acquired.coldStart, workerMs: performance.now() - acquired.acquiredAt });
  } catch {
    // Host telemetry must not change the operation result.
  }
}

function createRuntimeSlots(
  poolOptions: WorkspaceContentRuntimePoolOptions | undefined,
): RuntimeSlots | undefined {
  const queue = poolOptions?.queue;
  if (queue === undefined) return undefined;
  if (poolOptions?.maxWorkers === undefined) {
    throw workspaceError("workspace-argument-invalid", "pool.queue requires pool.maxWorkers.");
  }
  if (!Number.isInteger(poolOptions.maxWorkers) || poolOptions.maxWorkers < 1) {
    throw workspaceError(
      "workspace-argument-invalid",
      "pool.maxWorkers must be a positive integer when pool.queue is set.",
    );
  }
  if (!Number.isInteger(queue.timeoutMs) || queue.timeoutMs < 0 || queue.timeoutMs > MAX_TIMER_MS) {
    throw workspaceError(
      "workspace-argument-invalid",
      `pool.queue.timeoutMs must be an integer from 0 to ${String(MAX_TIMER_MS)}.`,
    );
  }
  return {
    capacity: poolOptions.maxWorkers,
    closed: false,
    held: new Map(),
    timeoutMs: queue.timeoutMs,
    waiting: new Map(),
  };
}

/** Node clamps a larger `setTimeout` delay to 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/** `deadline` is a `performance.now()` reading, immune to wall-clock steps. */
function enterRuntimeSlot(
  slots: RuntimeSlots,
  key: string,
  deadline: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfNotStartedAborted(signal);
  if (slots.closed) return Promise.reject(runtimeClosedError());
  const count = slots.held.get(key);
  if (count !== undefined) {
    slots.held.set(key, count + 1);
    return Promise.resolve();
  }
  if (slots.waiting.size === 0 && slots.held.size < slots.capacity) {
    slots.held.set(key, 1);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter: RuntimeSlotWaiter = {
      admit() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve();
      },
      reject(error) {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    };
    const remove = (error: Error) => {
      const waiters = slots.waiting.get(key) ?? [];
      const index = waiters.indexOf(waiter);
      if (index < 0) return;
      waiters.splice(index, 1);
      if (waiters.length === 0) slots.waiting.delete(key);
      waiter.reject(error);
    };
    const abort = () => remove(runtimeNotStartedError());
    const timer = setTimeout(
      () => remove(runtimeBusyError()),
      Math.max(0, deadline - performance.now()),
    );
    signal?.addEventListener("abort", abort, { once: true });
    const waiters = slots.waiting.get(key);
    if (waiters === undefined) slots.waiting.set(key, [waiter]);
    else waiters.push(waiter);
  });
}

function closeRuntimeSlots(slots: RuntimeSlots): void {
  slots.closed = true;
  const waiting = [...slots.waiting.values()].flat();
  slots.waiting.clear();
  for (const waiter of waiting) waiter.reject(runtimeClosedError());
}

function leaveRuntimeSlot(slots: RuntimeSlots, key: string): void {
  const count = (slots.held.get(key) ?? 1) - 1;
  if (count > 0) {
    slots.held.set(key, count);
    return;
  }
  slots.held.delete(key);
  while (slots.held.size < slots.capacity) {
    const next = slots.waiting.entries().next();
    if (next.done === true) return;
    const [nextKey, waiters] = next.value;
    slots.waiting.delete(nextKey);
    slots.held.set(nextKey, waiters.length);
    for (const waiter of waiters) waiter.admit();
  }
}

function runtimeBusyError() {
  return workspaceError(
    "workspace-runtime-busy",
    "All Workspace runtime workers are busy. Retry later.",
    { retryable: true },
  );
}

function runtimeClosedError() {
  return workspaceError("workspace-runtime-closed", "The Workspace runtime has been closed.");
}

function isPoolCapacityError(error: unknown): boolean {
  return (
    error instanceof UniverCollaborationRuntimePoolError &&
    error.code === "COLLABORATION_POOL_CAPACITY_EXCEEDED"
  );
}

async function runForRuntimeKey<T>(
  operationByKey: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const previous = operationByKey.get(key);
  let finish!: () => void;
  const current = new Promise<void>((resolve) => {
    finish = resolve;
  });
  operationByKey.set(key, current);
  try {
    if (previous !== undefined) await waitBeforeStart(previous, signal);
    throwIfNotStartedAborted(signal);
    return await operation();
  } finally {
    // An aborted waiter must not let the next call overtake the active operation.
    void (previous ?? Promise.resolve()).then(() => {
      finish();
      if (operationByKey.get(key) === current) operationByKey.delete(key);
    });
  }
}

async function acquire(
  pool: UniverCollaborationRuntimePool<WorkspaceContentWorkerInit>,
  initByKey: Map<string, WorkerInit>,
  options: WorkspaceContentRuntimeOptions,
  target: WorkspaceRuntimeTarget,
  caller: WorkspaceRuntimeCaller | undefined,
  capacityDeadline: number | undefined,
  signal?: AbortSignal,
): Promise<AcquiredWorkspaceRuntime> {
  const key = workspaceRuntimeKey(target, caller);
  let entry = initByKey.get(key);
  if (entry !== undefined && options.reuseWorker?.(entry.caller, caller) === false) {
    const old = await waitBeforeStart(entry.pending, signal);
    const stale = await acquireLease(pool, old, key, capacityDeadline, signal);
    initByKey.delete(key);
    await stale.invalidate();
    entry = undefined;
  }
  throwIfNotStartedAborted(signal);
  const coldStart = entry === undefined;
  if (entry === undefined) {
    entry = { caller, pending: resolveWorkerInit(options, target, caller) };
    initByKey.set(key, entry);
    const created = entry;
    void entry.pending.catch(() => {
      if (initByKey.get(key) === created) initByKey.delete(key);
    });
  }
  try {
    const init = await waitBeforeStart(entry.pending, signal);
    const lease = await acquireLease(pool, init, key, capacityDeadline, signal);
    if (signal?.aborted) {
      await lease.release();
      throw runtimeNotStartedError();
    }
    return { acquiredAt: performance.now(), coldStart, init, initEntry: entry, key, lease };
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "workspace-runtime-not-started"
      ) &&
      initByKey.get(key) === entry
    )
      initByKey.delete(key);
    throw error;
  }
}

/**
 * A slot freed by invalidate or destroy may still count in the pool while it tears down, so an
 * admitted operation retries the capacity error with backoff until its deadline.
 */
async function acquireLease(
  pool: UniverCollaborationRuntimePool<WorkspaceContentWorkerInit>,
  init: WorkspaceContentWorkerInit,
  key: string,
  capacityDeadline: number | undefined,
  signal?: AbortSignal,
): Promise<UniverCollaborationRuntimeLease> {
  for (let delayMs = 10; ; delayMs = Math.min(delayMs * 2, 200)) {
    try {
      throwIfNotStartedAborted(signal);
      return await pool.acquire({ init, key });
    } catch (error) {
      if (capacityDeadline === undefined || !isPoolCapacityError(error)) throw error;
      const remainingMs = capacityDeadline - performance.now();
      if (remainingMs <= 0) throw runtimeBusyError();
      await waitBeforeStart(
        new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs))),
        signal,
      );
    }
  }
}

async function commitStableChangeset(
  lease: UniverCollaborationRuntimeLease,
): Promise<Extract<CollaborationCommitResult, { readonly status: "confirmed" }>> {
  let lastResult: CollaborationCommitResult | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await lease.commit();
    lastResult = result;
    if (result.status === "confirmed") return result;
    if (result.status === "retry" || result.status === "unknown") continue;
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
  throw workspaceError(
    "workspace-submit-retry-exhausted",
    `Workspace changeset submit could not be confirmed after 3 attempts${awaiting === undefined ? "" : ` (sid ${awaiting.sid ?? "unknown"}, reqId ${String(awaiting.reqId ?? "unknown")})`}`,
  );
}

async function resolveWorkerInit(
  options: WorkspaceContentRuntimeOptions,
  target: WorkspaceRuntimeTarget,
  caller: WorkspaceRuntimeCaller | undefined,
): Promise<WorkspaceContentWorkerInit> {
  let credential: string | undefined;
  try {
    credential = await options.resolveCredential(target, caller);
  } catch {
    throw workspaceError(
      "workspace-authentication-required",
      "Log in to the current Workspace origin first.",
    );
  }
  if (credential === undefined || credential.length === 0) {
    throw workspaceError(
      "workspace-authentication-required",
      "Log in to the current Workspace origin first.",
    );
  }
  let license: string | undefined;
  try {
    license = await options.resolveLicense(caller);
  } catch {
    throw workspaceError("workspace-license-required", "Univer license is required.");
  }
  if (license === undefined || license.trim().length === 0) {
    throw workspaceError("workspace-license-required", "Univer license is required.");
  }
  return {
    credential,
    license,
    target: serializeWorkspaceRuntimeTarget(target),
    ...(options.transportOrigin === undefined ? {} : { transportOrigin: options.transportOrigin }),
  };
}

async function synchronize(
  lease: UniverCollaborationRuntimeLease,
  target: WorkspaceRuntimeTarget,
): Promise<void> {
  const before = await lease.getState();
  if (
    before.pendingMutationCount !== 0 ||
    before.awaitingChangeset !== null ||
    before.conflict !== null
  ) {
    throw workspaceError("WORKSPACE_RUNTIME_DIRTY", "Cached Workspace runtime is not reusable");
  }
  const pulled = await lease.pull();
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

function runtimeNotStartedError() {
  return workspaceError(
    "workspace-runtime-not-started",
    "The runtime call was aborted before it started.",
    {
      retryable: true,
      started: false,
    },
  );
}

function throwIfNotStartedAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw runtimeNotStartedError();
}

function waitBeforeStart<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return pending;
  throwIfNotStartedAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(runtimeNotStartedError());
    signal.addEventListener("abort", abort, { once: true });
    void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

const runtimeFailurePhases = new WeakMap<object, "script" | "commit">();

/** Identifies the failing runtime boundary without changing the CLI's original error. */
export function getWorkspaceRuntimeFailurePhase(error: unknown): "script" | "commit" | undefined {
  return typeof error === "object" && error !== null ? runtimeFailurePhases.get(error) : undefined;
}

async function inRuntimePhase<T>(
  phase: "script" | "commit",
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    const error = typeof cause === "object" && cause !== null ? cause : new Error(String(cause));
    runtimeFailurePhases.set(error, phase);
    throw error;
  }
}
