import { workspaceError } from "./errors.js";
import type { WorkspaceIssueFeature } from "./issue.js";
import {
  parseRepoReference,
  resolveItemTarget,
  type ResolvedWorkspaceRepo,
} from "./repo-ref.js";
import type { WorkspaceSpaceFeature } from "./space.js";
import type { WorkspaceSpace } from "./space-model.js";
import { issueUrl, pullUrl, repoUrl } from "./urls.js";
import type { WorkspaceWorktree, WorkspaceWorktreeState } from "./worktree-model.js";
import type { WorkspaceWorktreeFeature } from "./worktree.js";

export const PULL_REQUEST_STATES = ["open", "merged", "discarded", "all"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

/** Worktree list view and state filter for a pull request state name. */
export function pullRequestView(state: PullRequestState): {
  readonly view: "active" | "processed" | "all";
  readonly states?: readonly WorkspaceWorktreeState[];
} {
  switch (state) {
    case "open":
      return { view: "active" };
    case "merged":
      return { view: "processed", states: ["merged"] };
    case "discarded":
      return { view: "processed", states: ["discarded"] };
    case "all":
      return { view: "all" };
  }
}

/** A repository's Space, refusing a Personal Space the signed-in user does not own. */
export async function pullRequestSpace(
  spaces: Pick<WorkspaceSpaceFeature, "get">,
  userId: () => Promise<string>,
  spaceId: string,
): Promise<WorkspaceSpace> {
  const space = await spaces.get(spaceId);
  if (space.type === "personal" && space.owner?.id !== (await userId())) {
    throw workspaceError(
      "workspace-argument-invalid",
      "Personal Space pull requests must target the signed-in user's own Space.",
    );
  }
  return space;
}

/**
 * Pull requests of one repository (`space`) or, without `space`, of every repository the user can
 * see. A Personal Space lists the user's own User Worktrees; a Team Space lists its Worktrees.
 */
export async function listPullRequests(
  deps: { readonly userId: () => Promise<string>; readonly worktrees: Pick<WorkspaceWorktreeFeature, "list"> },
  input: {
    readonly author?: string;
    readonly limit: number;
    readonly search?: string;
    readonly space?: Pick<WorkspaceSpace, "id" | "type">;
    readonly state: PullRequestState;
  },
): Promise<readonly WorkspaceWorktree[]> {
  const { space, author, search } = input;
  return await deps.worktrees.list({
    ...(space === undefined
      ? {}
      : space.type === "personal"
        ? { scope: "user" as const }
        : { scope: "space" as const, spaceId: space.id }),
    ...pullRequestView(input.state),
    limit: input.limit,
    ...(search === undefined ? {} : { search }),
    ...(author === undefined
      ? {}
      : author === "@me"
        ? { creatorId: await deps.userId() }
        : { creatorUsername: author }),
  });
}

/** A `<n|#n|url|id>` argument becomes the Worktree it names; `spaceId` is set when it was a number. */
export async function findPullRequest(
  worktrees: Pick<WorkspaceWorktreeFeature, "get" | "getByNumber">,
  argument: string,
  origin: () => Promise<string>,
  repo: () => Promise<ResolvedWorkspaceRepo>,
): Promise<{ readonly worktree: WorkspaceWorktree; readonly spaceId?: string }> {
  const target = await resolveItemTarget(argument, "pr", origin, repo);
  return target.kind === "id"
    ? { worktree: await worktrees.get(target.id) }
    : { worktree: await worktrees.getByNumber(target.spaceId, target.number), spaceId: target.spaceId };
}

/** A User Worktree's Browser repository is its creator's Personal Space, not a Unit target. */
export async function pullSpaceId(
  spaces: Pick<WorkspaceSpaceFeature, "lookup">,
  worktree: WorkspaceWorktree,
  resolvedSpaceId?: string,
): Promise<string | undefined> {
  if (worktree.number == null) return undefined;
  if (worktree.spaceId !== undefined) return worktree.spaceId;
  if (resolvedSpaceId !== undefined) return resolvedSpaceId;
  if (worktree.kind !== "user" || worktree.creator === undefined) return undefined;
  const space = await spaces.lookup(worktree.creator.username, "personal");
  if (space.type !== "personal" || space.owner?.id !== worktree.creator.id) {
    throw workspaceError(
      "workspace-result-mismatch",
      "The Personal Space does not belong to the pull request's creator.",
    );
  }
  return space.id;
}

/**
 * The Browser URL of a repository, pull request or Issue. A pull request is tried before an Issue
 * because both share one number sequence in a Team Space.
 */
export async function browseUrl(
  deps: {
    readonly issues: Pick<WorkspaceIssueFeature, "get">;
    readonly origin: () => Promise<string>;
    readonly repo: () => Promise<ResolvedWorkspaceRepo>;
    readonly pullSpaceId: (worktree: WorkspaceWorktree) => Promise<string | undefined>;
    readonly worktrees: Pick<WorkspaceWorktreeFeature, "get" | "getByNumber">;
  },
  input: { readonly argument?: string; readonly unit?: string },
): Promise<{ readonly url: string }> {
  const { argument, unit } = input;
  const { issues, origin, repo, worktrees } = deps;
  const base = await origin();
  if (argument === undefined) {
    if (unit !== undefined) {
      throw workspaceError("workspace-argument-invalid", "--unit needs a pull request number.");
    }
    return { url: repoUrl(base, (await repo()).spaceId) };
  }
  const reference = /^https?:\/\//i.test(argument.trim()) ? parseRepoReference(argument) : undefined;
  const urlKind = reference?.kind === "url" ? reference.item?.kind : undefined;
  const target = await resolveItemTarget(argument, urlKind ?? "pr", origin, repo);
  if (target.kind === "id") {
    const worktree = await worktrees.get(target.id);
    return { url: pullUrl(base, worktree, unit, await deps.pullSpaceId(worktree)) };
  }
  if (urlKind !== "issue") {
    try {
      const worktree = await worktrees.getByNumber(target.spaceId, target.number);
      return { url: pullUrl(base, worktree, unit, target.spaceId) };
    } catch (error) {
      if (urlKind === "pr" || statusOf(error) !== 404) throw error;
    }
  }
  try {
    await issues.get(target.spaceId, target.number);
  } catch (error) {
    if (statusOf(error) === 404 || statusOf(error) === 409) {
      throw workspaceError(
        "workspace-not-found",
        `No Issue or pull request #${String(target.number)} in this repository.`,
      );
    }
    throw error;
  }
  return { url: issueUrl(base, target.spaceId, target.number) };
}

function statusOf(error: unknown): number | undefined {
  const detail = (error as { detail?: { status?: unknown } })?.detail;
  return typeof detail?.status === "number" ? detail.status : undefined;
}
