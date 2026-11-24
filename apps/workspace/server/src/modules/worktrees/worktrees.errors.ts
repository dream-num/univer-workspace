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

interface PullRequestRow {
  readonly id: string;
  readonly number: number | null;
  readonly team_space_id: string | null;
}

function pullRequestUrl(row: PullRequestRow, publicOrigin: string | null): string {
  const path = row.team_space_id !== null && row.number !== null
    ? `/spaces/${encodeURIComponent(row.team_space_id)}/pulls/${row.number}`
    : `/worktrees?worktree=${encodeURIComponent(row.id)}`;
  return `${publicOrigin ?? ""}${path}`;
}

export function pageReviewRequired(row: PullRequestRow, pages: readonly string[], publicOrigin: string | null): ApplicationError {
  return new ApplicationError(
    "PAGE_REVIEW_REQUIRED",
    409,
    `A person must merge this pull request in the browser, because its author cannot publish these pages or files alone: ${pages.join(", ")}. Review it at ${pullRequestUrl(row, publicOrigin)}.`,
  );
}

export function pagesChanged(row: PullRequestRow, publicOrigin: string | null): ApplicationError {
  return new ApplicationError(
    "PAGES_CHANGED",
    409,
    `The pages or files of this pull request changed since you reviewed it. Review them again at ${pullRequestUrl(row, publicOrigin)}.`,
  );
}

export function proposalStaysShared(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "This pull request is ready and its author cannot merge it, so it stays visible to the Space for a member with edit access to merge. Move it back to draft before making it private.",
  );
}

export function checkNeedsReady(state: string): ApplicationError {
  return new ApplicationError(
    "CONFLICT",
    409,
    `Check results are reported on a ready pull request, and this one is ${state}.${state === "draft" ? " Mark it ready first." : ""}`,
  );
}

export function tooManyChecks(limit: number): ApplicationError {
  return new ApplicationError(
    "CONFLICT",
    409,
    `This pull request already has results for ${limit} check names on its current content. Report on a name it already has.`,
  );
}

export function forkAlreadyOpen(): ApplicationError {
  return new ApplicationError("CONFLICT", 409, "The fork already has an open Worktree.");
}

export function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "This Worktree action is not allowed."
  );
}
