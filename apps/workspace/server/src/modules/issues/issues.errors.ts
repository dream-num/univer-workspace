import { ApplicationError } from "../../middleware/errors.js";

export function invalid(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}

export function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}

export function forbidden(): ApplicationError {
  return new ApplicationError("FORBIDDEN", 403, "The current user cannot perform this Issue action.");
}

export function labelNameTaken(): ApplicationError {
  return new ApplicationError("CONFLICT", 409, "A label with this name already exists.");
}
