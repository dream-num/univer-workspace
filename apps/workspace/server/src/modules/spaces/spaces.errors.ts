import { ApplicationError } from "../../middleware/errors.js";

export function spaceNotFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}

export function spaceUpdateForbidden(): ApplicationError {
  return new ApplicationError("FORBIDDEN", 403, "The current user cannot update this space.");
}
