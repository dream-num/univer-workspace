import { getSystemErrorMap } from "node:util";
import {
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { OpMeta } from "./usage.js";

export interface WireError {
  readonly outcome: "tool_error" | "auth_error" | "internal_error" | "timeout";
  readonly code: string;
  readonly message: string;
  readonly detail: z.core.util.JSONType;
}

const systemErrorCodes = new Set([...getSystemErrorMap().values()].map(([code]) => code));

const RESULT_UNKNOWN_MESSAGE =
  "The Workspace operation may have completed, but its result could not be confirmed. Retry with the same idempotency_key if the tool takes one; otherwise check the current state before repeating the write.";

export function translateError(error: unknown): WireError {
  if (
    error instanceof Error &&
    ("syscall" in error ||
      "path" in error ||
      ("code" in error &&
        typeof error.code === "string" &&
        (systemErrorCodes.has(error.code) ||
          /^workspace-(blob|asset)-(source|output)-/.test(error.code))))
  )
    return {
      outcome: "internal_error",
      code: "workspace-internal-error",
      message: "Internal tool error.",
      detail: null,
    };
  if (error instanceof ExecutorCallError)
    return { ...error.wire, detail: jsonOrNull(error.wire.detail) };
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return {
      outcome: "tool_error",
      code: "workspace-argument-invalid",
      message: `Invalid arguments: ${issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")}`,
      detail: { issues },
    };
  }
  if (isWorkspaceResultUnknown(error)) {
    return {
      outcome: "tool_error",
      code: "workspace-result-unknown",
      message: RESULT_UNKNOWN_MESSAGE,
      detail: error instanceof WorkspaceApplicationError ? jsonOrNull(error.detail) : null,
    };
  }
  if (error instanceof WorkspaceApplicationError) {
    return {
      outcome: error.code === "workspace-authentication-required" ? "auth_error" : "tool_error",
      code: error.code,
      message: error.message,
      detail: jsonOrNull(error.detail),
    };
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return {
      outcome: "tool_error",
      code: error.code,
      message: error.message,
      detail: null,
    };
  }
  return {
    outcome: "internal_error",
    code: "workspace-internal-error",
    message: "Internal tool error.",
    detail: null,
  };
}

export function jsonOrNull(value: unknown): z.core.util.JSONType {
  try {
    const clean: unknown = JSON.parse(
      JSON.stringify(value ?? null, (key, entry: unknown) =>
        key === "sourcePath" ||
        (key === "path" &&
          typeof entry === "string" &&
          entry.startsWith("/") &&
          !entry.startsWith("/api/") &&
          !entry.startsWith("/universer-api/"))
          ? undefined
          : entry,
      ),
    );
    const parsed = z.json().safeParse(clean);
    return parsed.success ? parsed.data : null;
  } catch {
    // A circular detail overflows the parser's stack.
    return null;
  }
}

export class ExecutorCallError extends Error {
  constructor(
    readonly wire: WireError,
    readonly meta?: OpMeta,
  ) {
    super(wire.message);
  }
}

export function resultUnknown(cause: string, timeout = false): WireError {
  return {
    code: "workspace-result-unknown",
    message: RESULT_UNKNOWN_MESSAGE,
    detail: { cause, retryable: false },
    outcome: timeout ? "timeout" : "tool_error",
  };
}
