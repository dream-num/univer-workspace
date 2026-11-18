import { ApplicationError } from "../../middleware/errors.js";

export function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "Worktree not found.");
}

export function onlyAuthorMerges(row: {
  readonly creator_username: string;
  readonly creator_display_name: string;
  readonly claimer_username: string | null;
  readonly claimer_display_name: string | null;
}): ApplicationError {
  const claimer = row.claimer_username === null
    ? ""
    : `, or ${row.claimer_display_name} (@${row.claimer_username}) who claimed it`;
  return new ApplicationError(
    "FORBIDDEN",
    403,
    `Only the author, ${row.creator_display_name} (@${row.creator_username})${claimer}, can merge this pull request.`,
  );
}

export function mergeNeedsEditAccess(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "You cannot merge this pull request without edit access to every file and folder it changes.",
  );
}

export function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "This Worktree action is not allowed."
  );
}
