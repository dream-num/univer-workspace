export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = "REQUEST_FAILED",
    readonly field?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiError(value: unknown): ApiError {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    const error = value.error as {
      readonly code?: unknown;
      readonly message: string;
      readonly field?: unknown;
    };
    return new ApiError(
      error.message,
      typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      typeof error.field === "string" ? error.field : undefined
    );
  }
  return new ApiError("The request could not be completed.");
}
