import { translateError, type WireError } from "../shared/errors.js";
import { ResourceCacheUnsafeError } from "./resources.js";

export type TranslatedToolError = WireError;

export function translateToolError(error: unknown): TranslatedToolError {
  if (error instanceof ResourceCacheUnsafeError) {
    return { outcome: "internal_error", code: error.code, message: error.message, detail: null };
  }
  return translateError(error);
}
