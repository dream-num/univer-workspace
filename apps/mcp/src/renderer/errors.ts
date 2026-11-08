import { isUnitLayoutLintError } from "@univer-cli/unit-layout-lint";
import { isUnitPdfPrinterError } from "@univer-cli/unit-pdf-printer";
import { isUnitScreenshotError } from "@univer-cli/unit-screenshot";
import { isUniverRenderError } from "@univer-cli/univer-render-runtime";
import { ExecutorCallError, translateError, type WireError } from "../shared/errors.js";

export function busyError(): ExecutorCallError {
  return new ExecutorCallError({
    code: "workspace-renderer-busy",
    message: "All renderer runtimes are busy. Retry later.",
    detail: { retryable: true },
    outcome: "tool_error",
  });
}

export function timeoutError(): ExecutorCallError {
  return new ExecutorCallError({
    code: "workspace-renderer-timeout",
    message: "The renderer timed out. Retry the operation.",
    detail: { retryable: true },
    outcome: "timeout",
  });
}

export function unavailableError(): ExecutorCallError {
  return new ExecutorCallError({
    code: "workspace-renderer-unavailable",
    message: "The renderer is shutting down.",
    detail: { retryable: true },
    outcome: "tool_error",
  });
}

/** The upstream code of an input error: the caller's unit or target was wrong, the runtime is fine. */
function inputReason(error: unknown): string | undefined {
  if (
    (isUnitScreenshotError(error) &&
      ["INVALID_INPUT", "PAGE_LIMIT_EXCEEDED", "PIXEL_LIMIT_EXCEEDED"].includes(error.code)) ||
    isUnitPdfPrinterError(error) ||
    (isUnitLayoutLintError(error) && error.code === "INVALID_INPUT") ||
    (isUniverRenderError(error) && error.code === "RENDER_TARGET_INVALID")
  )
    return error.code;
  return undefined;
}

export function isInputError(error: unknown): boolean {
  return inputReason(error) !== undefined;
}

export function mapRendererError(error: unknown): WireError {
  const reason = inputReason(error);
  if (reason !== undefined && error instanceof Error)
    return {
      outcome: "tool_error",
      code:
        reason === "UNSUPPORTED_UNIT_TYPE"
          ? "workspace-render-unit-unsupported"
          : "workspace-render-input-invalid",
      message: error.message,
      detail: { reason },
    };
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
    return timeoutError().wire;
  if (isUniverRenderError(error))
    return {
      outcome: "internal_error",
      code: "workspace-renderer-failed",
      message: "The renderer failed. Retry the operation.",
      detail: { retryable: true, reason: error.code },
    };
  return translateError(error);
}
