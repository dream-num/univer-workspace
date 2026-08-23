import type { ErrorRequestHandler, RequestHandler } from "express";

export type ApplicationErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CREDENTIALS"
  | "INVALID_CURRENT_PASSWORD"
  | "PASSWORD_NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "USERNAME_TAKEN"
  | "FORBIDDEN"
  | "CONFLICT"
  | "NOT_FOUND"
  | "RESTORE_PARENT_IN_TRASH"
  | "NESTED_TRASH_BATCH"
  | "ACTIVE_WORKTREE_RESOURCE_REFERENCE"
  | "PAYLOAD_TOO_LARGE"
  | "RANGE_NOT_SATISFIABLE"
  | "GITHUB_OAUTH_UNAVAILABLE"
  | "GITHUB_OAUTH_FAILED"
  | "DISCORD_OAUTH_UNAVAILABLE"
  | "DISCORD_OAUTH_FAILED"
  | "DISCORD_BOT_AUTH_UNAVAILABLE"
  | "OAUTH_CLIENT_UNAVAILABLE"
  | "INVALID_CLIENT_SECRET"
  | "INVALID_REDIRECT_URI"
  | "INVALID_GRANT"
  | "INVALID_STATE"
  | "INVALID_CODE_VERIFIER";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    readonly status: number,
    message: string,
    readonly field?: string
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

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next
) => {
  if (error instanceof ApplicationError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.field === undefined ? {} : { field: error.field }),
      },
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error.",
    },
  });
};
