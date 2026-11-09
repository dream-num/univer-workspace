import { WorkspaceApplicationError } from "@univerjs/univer-workspace-client-core/product";
import {
  ExecutorCallError,
  jsonOrNull,
  resultUnknown,
  translateError,
  type WireError,
} from "../shared/errors.js";
import type { OpEffect } from "../shared/executor-protocol.js";

export function timeoutError(
  effect: OpEffect,
  phase: "open" | "operation" | "deadline" = "deadline",
  started = phase !== "open",
): ExecutorCallError {
  const unknown = effect === "write" && started;
  return new ExecutorCallError({
    code: unknown ? "workspace-result-unknown" : "workspace-executor-timeout",
    message: unknown
      ? "The write may have completed. Check the current state before repeating it."
      : "The executor timed out. Retry the operation.",
    detail: { phase, retryable: !unknown, ...(!started ? { started: false } : {}) },
    outcome: "timeout",
  });
}

export function mapRuntimeError(error: unknown, effect: OpEffect): WireError {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "workspace-runtime-not-started")
    return {
      code: "workspace-executor-timeout",
      message: "The executor deadline elapsed before the operation started. Retry the operation.",
      detail: {
        retryable: true,
        started: false,
        ...(error instanceof WorkspaceApplicationError &&
        typeof error.detail === "object" &&
        error.detail !== null &&
        "cause" in error.detail
          ? { cause: jsonOrNull(error.detail.cause) }
          : {}),
      },
      outcome: "timeout",
    };
  if (code === "workspace-submit-retry-exhausted" && effect === "write") return resultUnknown(code);
  if (
    code === "INSPECTION_RESULT_INVALID" ||
    code === "workspace-runtime-result-invalid" ||
    code === "WORKSPACE_RUNTIME_RESULT_INVALID"
  )
    return {
      code: "workspace-runtime-result-invalid",
      message: "The runtime returned an invalid result.",
      detail: null,
      outcome: "internal_error",
    };
  if (code === "COLLABORATION_WORKER_OPEN_TIMEOUT") return timeoutError(effect, "open").wire;
  if (code === "COLLABORATION_WORKER_OPERATION_TIMEOUT")
    return effect === "write" ? resultUnknown(code, true) : timeoutError(effect, "operation").wire;
  if (code === "workspace-job-crashed") return translateError(error);
  if (code === "COLLABORATION_WORKER_CRASHED") {
    return effect === "write"
      ? resultUnknown(code)
      : { ...timeoutError(effect, "operation").wire, outcome: "internal_error" };
  }
  if (code === "COLLABORATION_POOL_CAPACITY_EXCEEDED" || code === "workspace-runtime-busy") {
    return {
      code: "workspace-runtime-busy",
      message: "All executor workers are busy. Retry later.",
      detail: { retryable: true },
      outcome: "tool_error",
    };
  }
  return translateError(error);
}
