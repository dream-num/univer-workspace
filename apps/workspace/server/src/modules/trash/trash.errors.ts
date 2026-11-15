import { ApplicationError } from "../../middleware/errors.js";

export function trashNotFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "Trash Batch not found.");
}

export function trashBatchMismatch(): ApplicationError {
  return new ApplicationError("CONFLICT", 409, "The Trash Batch belongs to a different deletion request.");
}
