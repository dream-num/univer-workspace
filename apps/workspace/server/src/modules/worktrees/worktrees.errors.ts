import { ApplicationError } from "../../middleware/errors.js";

export function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "Worktree not found.");
}

// A Team Space admits no agent, so a Team Worktree's author is a person with no claimer to name.
export function onlyAuthorMerges(author: {
  readonly creator_username: string;
  readonly creator_display_name: string;
}): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    `Only the author, ${author.creator_display_name} (@${author.creator_username}), can merge this pull request.`,
  );
}

export function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "This Worktree action is not allowed."
  );
}
