import {
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";

export interface TranslatedToolError {
  readonly outcome: "tool_error" | "auth_error" | "internal_error";
  readonly code: string;
  readonly message: string;
  readonly detail: z.core.util.JSONType;
}

const RESULT_UNKNOWN_MESSAGE =
  "The Workspace operation may have completed, but its result could not be confirmed. Retry with the same idempotency_key if the tool takes one; otherwise check the current state before repeating the write.";

export function translateToolError(error: unknown): TranslatedToolError {
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
    return { outcome: "tool_error", code: error.code, message: error.message, detail: null };
  }
  return {
    outcome: "internal_error",
    code: "workspace-internal-error",
    message: "Internal tool error.",
    detail: null,
  };
}

function jsonOrNull(value: unknown): z.core.util.JSONType {
  try {
    const parsed = z.json().safeParse(value ?? null);
    return parsed.success ? parsed.data : null;
  } catch {
    // A circular detail overflows the parser's stack.
    return null;
  }
}
