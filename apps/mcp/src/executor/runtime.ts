import {
  createWorkspaceContentRuntime,
  getWorkspaceRuntimeFailurePhase,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeObservation,
  type WorkspaceRuntimeCaller,
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

const workerForCaller = new WeakMap<WorkspaceRuntimeCaller, WorkspaceRuntimeCaller>();
const rejectedWorkers = new WeakSet<WorkspaceRuntimeCaller>();
const runtimeReruns = new WeakMap<object, "revision" | "auth">();

export function getRuntimeRerun(error: unknown) {
  return typeof error === "object" && error !== null ? runtimeReruns.get(error) : undefined;
}

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
  invalidateGrant: (grant: ExecutorGrant) => void = () => {},
): BoundRuntime {
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
      const caller = { userId: grant.userId, grant };
      return await runtimeCall("read", caller, invalidateGrant, () =>
        runtime.executeRead({ ...input, caller, observe, signal }),
      );
    },
    executeAndCommit: async (input) => {
      bind(input.target);
      const caller = { userId: grant.userId, grant };
      return await runtimeCall("write", caller, invalidateGrant, () =>
        runtime.executeAndCommit({ ...input, caller, observe, signal }),
      );
    },
    exportUnitData: async (input) => {
      bind(input.target);
      const caller = { userId: grant.userId, grant };
      return await runtimeCall("read", caller, invalidateGrant, () =>
        runtime.exportUnitData({ ...input, caller, observe, signal }),
      );
    },
  };
}

export const reuseExecutorWorker: NonNullable<
  Parameters<typeof createWorkspaceContentRuntime>[0]["reuseWorker"]
> = (created, current) => {
  const parsed = executorGrantSchema.safeParse(created?.grant);
  const reuse =
    created !== undefined &&
    !rejectedWorkers.has(created) &&
    parsed.success &&
    parsed.data.expiresAt > Date.now() + 60_000;
  if (current !== undefined && created !== undefined && reuse)
    workerForCaller.set(current, created);
  return reuse;
};

// workaround: SDK 1.4 reports a ticket or collaboration HTTP status only in the message of a
// COLLABORATION_UNAVAILABLE error. Affects runtime reads, executes and exports (content.execute,
// content.inspect, exchange.export, htmlView.validate, htmlView.create). Remove once the SDK
// exports a structured HTTP status.
function sdkHttpStatus(error: unknown): 401 | 403 | undefined {
  if (!(error instanceof Error && "code" in error && error.code === "COLLABORATION_UNAVAILABLE"))
    return undefined;
  const match =
    /^(?:Session ticket request failed with HTTP|Collaboration HTTP request failed with status) (401|403)$/.exec(
      error.message,
    );
  return match ? (Number(match[1]) as 401 | 403) : undefined;
}

async function runtimeCall<T>(
  effect: OpEffect,
  caller: WorkspaceRuntimeCaller,
  invalidateGrant: (grant: ExecutorGrant) => void,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    const phase = getWorkspaceRuntimeFailurePhase(error);
    const created = workerForCaller.get(caller) ?? caller;
    const createdGrant = executorGrantSchema.parse(created.grant);
    const ownSession =
      grantCookie(createdGrant) === grantCookie(executorGrantSchema.parse(caller.grant));
    const status = sdkHttpStatus(error);
    // A revoked session reads as 403 on trunk collaboration endpoints. It only means "stale" for a
    // worker made for another session; the caller's own 403 is a real permission error.
    const unauthorized =
      code === "workspace-authentication-required" ||
      status === 401 ||
      (status === 403 && !ownSession);
    if (unauthorized) {
      invalidateGrant(createdGrant);
      rejectedWorkers.add(created);
    }
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
    if (unauthorized) {
      const cause = { code: code ?? null, message: error instanceof Error ? error.message : "" };
      if (ownSession)
        throw workspaceError(
          "workspace-authentication-required",
          "Workspace Session is missing or expired.",
          { cause },
        );
      // The rejected session belongs to a warm worker made for another call. The caller's own
      // session is untested, so this must not look like an authentication failure to the client.
      const stale = workspaceError(
        "workspace-runtime-not-started",
        "A cached executor worker held a revoked session and was replaced. Retry the operation.",
        { retryable: true, started: false, cause },
      );
      runtimeReruns.set(stale, "auth");
      throw stale;
    }
    // Both are raised while a worker opens or pulls, before the script runs and before any commit,
    // so a rerun cannot repeat a write.
    if (
      (code === "workspace-result-mismatch" || code === "workspace-runtime-target-stale") &&
      phase === undefined &&
      error instanceof Error
    )
      runtimeReruns.set(error, "revision");
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
