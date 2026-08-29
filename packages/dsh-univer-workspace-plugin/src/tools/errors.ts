/**
 * Stable errors for the Workspace tool boundary.
 *
 * Tool bodies cross the DSH execution boundary, where an arbitrary thrown
 * `Error` otherwise loses its machine-routable class and is rendered with a
 * provider-specific message.  Keep the classification here, next to the
 * tool definitions, so the service/provider layers do not need to know about
 * DSH presentation concerns.
 *
 * @module dsh-univer-workspace-plugin/tools/errors
 */

import { HarnessError } from "@deepseek-ai/dsh-llm";
import { WorkspaceApiError } from "../provider/api-errors.ts";

/** Stable domain error used by all Workspace Univer tools. */
export class UniverError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options);
  }
}

/** Classify an arbitrary tool failure without exposing a stack or cause chain. */
export function asUniverError(error: unknown, fallbackCode: string): UniverError {
  if (error instanceof WorkspaceApiError) {
    const code = workspaceCode(error);
    return new UniverError(workspaceMessage(error), code, { cause: error });
  }

  // Never pass an upstream HarnessError through unchanged. Provider and
  // adapter errors are allowed to carry request URLs, local paths, or nested
  // diagnostics in their human message. Re-wrap them so only our stable code
  // and a redacted one-line message cross the model/UI boundary.
  if (error instanceof HarnessError) {
    const code = normalizeCode(error.code || fallbackCode);
    return new UniverError(publicMessage(error.message, code), code, { cause: error });
  }

  // A few package-local adapters deliberately avoid a DSH dependency and
  // expose a stable `code` field on ordinary Error subclasses (for example
  // LocalExchangeError). Preserve only the allow-listed semantic mappings;
  // never echo an arbitrary provider code into the model boundary.
  if (isCodedError(error)) {
    const code = mappedAdapterCode(error.code, fallbackCode);
    return new UniverError(publicMessage(error.message, code), code, { cause: error });
  }

  if (error instanceof Error) {
    const code = normalizeCode(fallbackCode);
    return new UniverError(publicMessage(error.message, code), code, { cause: error });
  }

  const code = normalizeCode(fallbackCode);
  return new UniverError(publicMessage(String(error), code), code, { cause: error });
}

/** Keep user-facing tool diagnostics one line and bounded; never include a stack. */
function normalizeMessage(message: string): string {
  const value = message.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (value.length === 0) return "The Univer Workspace operation failed.";
  return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
}

function normalizeCode(code: string): string {
  const value = code.replace(/[^A-Za-z0-9_]/gu, "_").toUpperCase();
  return value.length === 0 ? "WORKSPACE_OPERATION_FAILED" : value.slice(0, 64);
}

/** Public, redacted projection for a registry failure that bypassed execute. */
export function safeToolFailureMessage(message: string, code = "WORKSPACE_OPERATION_FAILED"): string {
  return publicMessage(message, normalizeCode(code));
}

function isCodedError(error: unknown): error is Error & { readonly code: string } {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && error.code.length > 0;
}

function mappedAdapterCode(code: string, fallbackCode: string): string {
  switch (code) {
    case "UNSUPPORTED_IMPORT_FORMAT": return "IMPORT_FORMAT_UNSUPPORTED";
    case "UNSUPPORTED_EXPORT_FORMAT": return "EXPORT_FORMAT_UNSUPPORTED";
    case "EXPORT_TYPE_MISMATCH": return "EXPORT_TYPE_MISMATCH";
    case "INVALID_UNIT_DATA": return "UNIT_DATA_INVALID";
    case "INITIAL_DATA_TOO_LARGE": return "UNIT_DATA_TOO_LARGE";
    default: return normalizeCode(fallbackCode);
  }
}

function workspaceCode(error: WorkspaceApiError): string {
  if (error.status === 401 || error.status === 403) return "WORKSPACE_ACCESS_DENIED";
  if (error.status === 404) return "WORKSPACE_NOT_FOUND";
  if (error.status === 409) return "WORKSPACE_CONFLICT";
  if (error.status === 429) return "WORKSPACE_RATE_LIMITED";
  if (error.status === 400 || error.status === 422) return "WORKSPACE_INVALID_REQUEST";
  if (error.status === 408) return "WORKSPACE_TIMEOUT";
  if (error.status >= 500 && error.status <= 599) return "WORKSPACE_UNAVAILABLE";
  // API response codes are data, not trusted presentation. Keep only a small
  // stable identifier when it is already in the Workspace namespace; all
  // provider-specific codes collapse to one public operation class.
  const candidate = normalizeCode(error.code);
  return candidate.startsWith("WORKSPACE_") && candidate.length <= 64
    ? candidate
    : "WORKSPACE_OPERATION_FAILED";
}

function workspaceMessage(error: WorkspaceApiError): string {
  if (error.status === 401 || error.status === 403) return "Workspace authorization was denied.";
  if (error.status === 404) return "The requested Workspace resource was not found.";
  if (error.status === 409) return "The Workspace resource changed concurrently; refresh status and retry.";
  if (error.status === 429) return "Workspace rate limit exceeded; retry later.";
  if (error.status === 400 || error.status === 422) return "The Workspace request was rejected.";
  if (error.status === 408) return "The Workspace request timed out; retry later.";
  if (error.status >= 500 && error.status <= 599) return "The Workspace service is temporarily unavailable.";
  return publicMessage(error.message, workspaceCode(error));
}

/**
 * Redact host/provider details before a message is rendered to the model.
 * Validation messages authored by this package remain useful; anything that
 * looks like a URL, absolute path, bearer/secret assignment, or stack frame is
 * replaced. A suspicious residual falls back to a code-specific generic line.
 */
function publicMessage(message: string, code: string): string {
  const normalized = normalizeMessage(message);
  const worksheetHint = worksheetSelectorHint(normalized);
  if (worksheetHint !== null) return worksheetHint;
  const redacted = normalized
    // Stack traces can be embedded in a message by fetch/worker wrappers.
    .replace(/\s+at\s+(?:async\s+)?[^\s(]+(?:\s+\([^)]*\))?/giu, "")
    // URLs and protocol-relative internal endpoints.
    .replace(/(?:https?|wss?|ftp):\/\/[^\s)\]}>,;]+/giu, "[redacted URL]")
    .replace(/(^|\s)\/\/(?:[^\s/]+\/)+[^\s]*/gu, "$1[redacted URL]")
    // Unix and Windows absolute paths. Keep relative user paths intact.
    .replace(/(^|[\s("'`])(?:\/(?:[^\s/"'`)]+\/)*[^\s/"'`)]*|[A-Za-z]:[\\/][^\s"'`)]+)/gu, (_match, prefix: string) => `${prefix}[redacted path]`)
    // Common credential-bearing fields and JWT-like bearer values.
    .replace(/\b(authorization|bearer|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|client[_ -]?secret|password|secret|token)(\s*[:=])\s*(?:bearer\s+)?[^\s,;]+/giu, "$1$2[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_.-]{8,}\b/gu, "[redacted token]");

  // The replacement above intentionally preserves ordinary validation prose,
  // but reject any residual high-risk marker rather than guessing.
  if (/(?:https?:\/\/|wss?:\/\/|Bearer\s+|\b(?:sk-|sk_live_|ghp_|xox[baprs]-)[A-Za-z0-9_-]+|(?:^|\s|["'`])\/(?:root|home|tmp|var|etc|opt|workspace|mnt|usr|srv|app)(?:\/|\s|["'`]|$)|[A-Za-z]:\\)/iu.test(redacted)) {
    return genericMessage(code);
  }
  return redacted || genericMessage(code);
}

/** Turn the common Univer worksheet lookup failure into an actionable tool error. */
function worksheetSelectorHint(message: string): string | null {
  if (!/worksheet selector did not match(?: a worksheet| any worksheet)/iu.test(message)) return null;
  return "No worksheet matched the requested selector. Use univer_inspect without `range` to list the exact worksheet name, then retry with `<worksheet-name>!A1:D20`; worksheet names are case-sensitive, and names containing spaces must be quoted (for example `'Sheet 1'!A1:D20`).";
}

function genericMessage(code: string): string {
  switch (code) {
    case "SCREENSHOT_ATTACHMENTS_UNAVAILABLE":
      return "Screenshot attachments are unavailable in this deployment.";
    case "SCREENSHOT_MEDIA_TYPE_UNAVAILABLE":
      return "This deployment does not accept PNG screenshot attachments.";
    case "SCREENSHOT_MODEL_ROUTE_UNAVAILABLE":
      return "The current model route cannot accept screenshot input.";
    case "SCREENSHOT_MODEL_NOT_IMAGE_CAPABLE":
      return "The current model does not support image input.";
    case "WORKSPACE_ACCESS_DENIED":
      return "Workspace authorization was denied.";
    case "WORKSPACE_NOT_FOUND":
      return "The requested Workspace resource was not found.";
    case "WORKSPACE_CONFLICT":
      return "The Workspace resource changed concurrently; refresh status and retry.";
    case "WORKSPACE_RATE_LIMITED":
      return "Workspace rate limit exceeded; retry later.";
    default:
      return "The Univer Workspace operation failed.";
  }
}
