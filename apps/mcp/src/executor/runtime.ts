import {
  createWorkspaceContentRuntime,
  getWorkspaceRuntimeFailurePhase,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeObservation,
} from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { ExecutorCallError, resultUnknown } from "../shared/errors.js";
import type { ExecutorConfig } from "../shared/config-executor.js";
import {
  executorGrantSchema,
  type ExecutorGrant,
  type OpEffect,
} from "../shared/executor-protocol.js";
import type { OpMeta } from "../shared/usage.js";
import type { BoundRuntime } from "./context.js";
import { grantCookie, resolveGrant } from "./credentials.js";
import { UNIVER_LICENSE } from "./license.js";

export const workerEnvironment = { NODE_ENV: "production" };

export function createExecutorRuntime(config: ExecutorConfig): WorkspaceContentRuntime {
  return createWorkspaceContentRuntime({
    resolveCredential: (_target, caller) => grantCookie(resolveGrant(caller?.grant)),
    reuseWorker: reuseExecutorWorker,
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
    if (signal.aborted)
      throw workspaceError(
        "workspace-runtime-not-started",
        "The runtime call was aborted before it started.",
        { retryable: true, started: false },
      );
    usage.unitType = target.unitType;
  };
  return {
    executeRead: async (input) => {
      bind(input.target);
      return await runtimeCall("read", () =>
        runtime.executeRead({ ...input, caller, observe, signal }),
      );
    },
    executeAndCommit: async (input) => {
      bind(input.target);
      return await runtimeCall("write", () =>
        runtime.executeAndCommit({ ...input, caller, observe, signal }),
      );
    },
    exportUnitData: (input) => {
      bind(input.target);
      return runtime.exportUnitData({ ...input, caller, observe, signal });
    },
  };
}

export const reuseExecutorWorker: NonNullable<
  Parameters<typeof createWorkspaceContentRuntime>[0]["reuseWorker"]
> = (created) => {
  const parsed = executorGrantSchema.safeParse(created?.grant);
  return parsed.success && parsed.data.expiresAt > Date.now() + 60_000;
};

async function runtimeCall<T>(effect: OpEffect, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    const phase = getWorkspaceRuntimeFailurePhase(error);
    if (
      effect === "write" &&
      phase === "commit" &&
      ![
        "WORKSPACE_RUNTIME_CONFLICT",
        "WORKSPACE_RUNTIME_PULL_REQUIRED",
        "WORKSPACE_RUNTIME_COMMIT_INVALID",
      ].includes(code ?? "")
    ) {
      const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      throw new ExecutorCallError(
        resultUnknown(code ?? (timeout ? error.name : "workspace-internal-error"), timeout),
      );
    }
    if (code === undefined && phase === "script" && effect === "write") {
      throw new ExecutorCallError({
        code: "workspace-script-failed",
        message: error instanceof Error ? error.message : String(error),
        detail: error instanceof Error && error.name ? { name: error.name } : {},
        outcome: "tool_error",
      });
    }
    throw error;
  }
}
