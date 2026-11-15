import { ApplicationError } from "../../middleware/errors.js";

export function nodeForbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "The current user cannot perform this action."
  );
}

export function nodeNotFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}
