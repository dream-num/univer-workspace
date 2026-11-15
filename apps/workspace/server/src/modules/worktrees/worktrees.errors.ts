import { ApplicationError } from "../../middleware/errors.js";

export function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "Worktree not found.");
}

export function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "This Worktree action is not allowed."
  );
}
