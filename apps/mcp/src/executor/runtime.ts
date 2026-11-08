import {
  createWorkspaceContentRuntime,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeObservation,
} from "@univerjs/univer-workspace-client-core";
import type { ExecutorConfig } from "../shared/config-executor.js";
import type { ExecutorGrant } from "../shared/executor-protocol.js";
import type { OpMeta } from "../shared/usage.js";
import type { BoundRuntime } from "./context.js";
import { grantCookie, resolveGrant } from "./credentials.js";
import { UNIVER_LICENSE } from "./license.js";

export const workerEnvironment = { NODE_ENV: "production" };

export function createExecutorRuntime(config: ExecutorConfig): WorkspaceContentRuntime {
  return createWorkspaceContentRuntime({
    resolveCredential: (_target, caller) => grantCookie(resolveGrant(caller?.grant)),
    resolveLicense: () => config.UNIVER_LICENSE ?? UNIVER_LICENSE,
    workerEntry: new URL("./worker.js", import.meta.url),
    transportOrigin: config.WORKSPACE_TRANSPORT_URL,
    pool: {
      env: workerEnvironment,
      maxWorkers: config.EXECUTOR_MAX_WORKERS,
      idleTtlMs: config.EXECUTOR_IDLE_TTL_MS,
      openTimeoutMs: config.EXECUTOR_OPERATION_TIMEOUT_MS,
      operationTimeoutMs: config.EXECUTOR_OPERATION_TIMEOUT_MS,
      queue: { timeoutMs: config.EXECUTOR_QUEUE_TIMEOUT_MS },
    },
  });
}

export function bindRuntime(
  runtime: WorkspaceContentRuntime,
  grant: ExecutorGrant,
  usage: OpMeta,
  signal: AbortSignal,
): BoundRuntime {
  const caller = { userId: grant.userId, grant };
  const observe = ({ coldStart, workerMs }: WorkspaceContentRuntimeObservation) => {
    if (coldStart || usage.executor === "none") usage.executor = coldStart ? "cold_start" : "warm";
    usage.cost.worker_cpu_ms += workerMs;
  };
  const bind = (target: Parameters<BoundRuntime["executeRead"]>[0]["target"]) => {
    signal.throwIfAborted();
    usage.unitType = target.unitType;
  };
  return {
    executeRead: (input) => {
      bind(input.target);
      return runtime.executeRead({ ...input, caller, observe });
    },
    executeAndCommit: (input) => {
      bind(input.target);
      return runtime.executeAndCommit({ ...input, caller, observe });
    },
    exportUnitData: (input) => {
      bind(input.target);
      return runtime.exportUnitData({ ...input, caller, observe });
    },
  };
}
