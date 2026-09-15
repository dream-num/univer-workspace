import { UniverError } from "./errors.ts";

/** Workspace Blob operation IDs are supplied by the caller and remain stable on retries. */
export function requireBlobIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{16,200}$/.test(value)) {
    throw new UniverError(
      "idempotencyKey must contain 16–200 ASCII letters, digits, underscores or hyphens. Use a UUID and reuse it only for an identical write retry.",
      "INVALID_REQUEST",
    );
  }
  return value;
}
