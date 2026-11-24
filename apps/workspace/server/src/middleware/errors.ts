import type { ErrorRequestHandler, RequestHandler } from "express";
import { requestLogger } from "./logging.js";

export type ApplicationErrorCode =
  | "SKILL_SOURCE_UNAVAILABLE"
  | "SKILL_SOURCE_RATE_LIMITED"
  | "SKILL_SOURCE_TRUNCATED"
  | "SKILL_SOURCE_AMBIGUOUS"
  | "INVALID_INPUT"
  | "INVALID_CREDENTIALS"
  | "INVALID_CURRENT_PASSWORD"
  | "PASSWORD_NOT_CONFIGURED"
  | "PASSWORD_AUTH_DISABLED"
  | "EMAIL_AUTH_DISABLED"
  | "EMAIL_CODE_RATE_LIMITED"
  | "INVALID_EMAIL_CODE"
  | "EMAIL_DELIVERY_FAILED"
  | "AGENT_CREATE_RATE_LIMITED"
  | "AGENT_CLAIM_INVALID"
  | "AGENT_CLAIM_EXPIRED"
  | "AGENT_CLAIM_UNAVAILABLE"
  | "AGENT_ALREADY_CLAIMED"
  | "REPORT_RATE_LIMITED"
  | "AGENT_NOT_ALLOWED"
  | "AGENT_QUOTA_EXCEEDED"
  | "INTERACTIVE_SESSION_REQUIRED"
  | "UNAUTHENTICATED"
  | "USERNAME_TAKEN"
  | "SPACE_SLUG_TAKEN"
  | "FORBIDDEN"
  | "HTML_VIEW_DRAFT_REQUIRED"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "NOT_FOUND"
  | "RESTORE_PARENT_IN_TRASH"
  | "NESTED_TRASH_BATCH"
  | "ACTIVE_WORKTREE_RESOURCE_REFERENCE"
  | "FORK_WORKTREE_NOT_DRAFT"
  | "PAGE_REVIEW_REQUIRED"
  | "PAYLOAD_TOO_LARGE"
  | "RANGE_NOT_SATISFIABLE"
  | "GITHUB_OAUTH_UNAVAILABLE"
  | "GITHUB_OAUTH_FAILED"
  | "GOOGLE_OAUTH_UNAVAILABLE"
  | "GOOGLE_OAUTH_FAILED"
  | "DISCORD_OAUTH_UNAVAILABLE"
  | "DISCORD_OAUTH_FAILED"
  | "DISCORD_BOT_AUTH_UNAVAILABLE"
  | "OAUTH_CLIENT_UNAVAILABLE"
  | "CLIENT_METADATA_BUSY"
  | "INVALID_CLIENT_SECRET"
  | "INVALID_REDIRECT_URI"
  | "INVALID_GRANT"
  | "INVALID_STATE"
  | "INVALID_CODE_VERIFIER"
  | "CLI_AUTHORIZATION_INVALID"
  | "CLI_AUTHORIZATION_EXPIRED"
  | "CLI_AUTHORIZATION_UNAVAILABLE";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    readonly status: number,
    message: string,
    readonly field?: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The resource was not found.",
    },
  });
};

// Express's JSON parser rejects a body before any route runs, naming the cause in `type`.
const bodyErrors: Readonly<Record<string, ApplicationError>> = {
  "entity.parse.failed": new ApplicationError("INVALID_INPUT", 400, "The request body is not valid JSON."),
  "entity.too.large": new ApplicationError("PAYLOAD_TOO_LARGE", 413, "The request body is too large."),
};

export const errorHandler: ErrorRequestHandler = (
  thrown: unknown,
  request,
  response,
  _next
) => {
  const type = (thrown as { type?: unknown } | null)?.type;
  const error = typeof type === "string" && Object.hasOwn(bodyErrors, type) ? bodyErrors[type] : thrown;
  if (error instanceof ApplicationError) {
    if (error.retryAfterSeconds !== undefined) response.set("Retry-After", String(error.retryAfterSeconds));
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.field === undefined ? {} : { field: error.field }),
      },
    });
    return;
  }

  // Correlate unexpected errors with the request ID returned to the caller.
  requestLogger(request).error({ err: error }, "unhandled request error");
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error.",
    },
  });
};
