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
import { workspaceError } from "./errors.js";
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
    readonly target: WorkspaceRuntimeTarget;
  }): Promise<WorkspaceContentRuntimeWriteResult>;
  executeRead(input: {
    readonly code: string;
    readonly target: WorkspaceRuntimeTarget;
  }): Promise<CollaborationRuntimeReadResult>;
  exportUnitData(input: {
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
  ) => Promise<string | undefined> | string | undefined;
  readonly resolveLicense: () => Promise<string | undefined> | string | undefined;
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

  return {
    async close() {
      try {
        await pool.close();
      } finally {
        initByKey.clear();
      }
    },
    async executeRead(input) {
      return await runForRuntimeKey(operationByKey, input.target, async () => {
        const { lease } = await acquire(pool, initByKey, options, input.target);
        try {
          await synchronize(lease, input.target);
          return await lease.execute({ code: input.code, mode: "read" });
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
      return await runForRuntimeKey(operationByKey, input.target, async () => {
        const { init, initEntry, key, lease } = await acquire(
          pool,
          initByKey,
          options,
          input.target,
        );
        let reusable = false;
        try {
          await synchronize(lease, input.target);
          const executed: unknown = await lease.execute({ code: input.code, mode: "write" });
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
          });
          const mutations = await externalizeEmbeddedImages({
            mutations: executed["mutations"],
            unitId: input.target.unitId,
            uploader: createWorkspaceEmbeddedImageUploader(http),
            worktreeId,
          });
          await lease.replacePendingMutations(mutations);
          const committed = await commitStableChangeset(lease);
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
      return await runForRuntimeKey(operationByKey, input.target, async () => {
        const { lease } = await acquire(pool, initByKey, options, input.target);
        try {
          await synchronize(lease, input.target);
          return await lease.exportUnitData();
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
  operation: () => Promise<T>,
): Promise<T> {
  const key = workspaceRuntimeKey(target);
  const previous = operationByKey.get(key);
  let finish!: () => void;
  const current = new Promise<void>((resolve) => {
    finish = resolve;
  });
  operationByKey.set(key, current);
  if (previous !== undefined) await previous;
  try {
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
): Promise<AcquiredWorkspaceRuntime> {
  const key = workspaceRuntimeKey(target);
  let pending = initByKey.get(key);
  if (pending === undefined) {
    pending = resolveWorkerInit(options, target);
    initByKey.set(key, pending);
    void pending.catch(() => {
      if (initByKey.get(key) === pending) initByKey.delete(key);
    });
  }
  const init = await pending;
  try {
    return { init, initEntry: pending, key, lease: await pool.acquire({ init, key }) };
  } catch (error) {
    if (initByKey.get(key) === pending) initByKey.delete(key);
    throw error;
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
): Promise<WorkspaceContentWorkerInit> {
  let credential: string | undefined;
  try {
    credential = await options.resolveCredential(target);
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
    license = await options.resolveLicense();
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
