import type { ErrorRequestHandler, RequestHandler } from "express";

export type ApplicationErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "NOT_FOUND"
  | "GITHUB_OAUTH_UNAVAILABLE"
  | "GITHUB_OAUTH_FAILED"
  | "OBSERVER_NOT_INITIALIZED"
  | "OBSERVER_ALREADY_INITIALIZED"
  | "OBSERVER_SETUP_UNAVAILABLE"
  | "OBSERVER_SETUP_TOKEN_INVALID"
  | "QUERY_BUSY"
  | "QUERY_TIMEOUT";

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
    error: { code: "NOT_FOUND", message: "The resource was not found." },
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
    error: { code: "INTERNAL_ERROR", message: "Internal server error." },
  });
};
