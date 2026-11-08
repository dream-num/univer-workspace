import {
  findPullRequest,
  pullSpaceId,
  pullUrl,
  WorkspaceSpaceFeature,
  WorkspaceWorktreeFeature,
  type WorkspaceSpace,
  type WorkspaceWorktree,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { ToolContext } from "../definition.js";
import { resolveRepo } from "./issue-support.js";

export const pullNumberInput = z
  .string()
  .describe(
    "Pull request number (12 or #12), its Workspace URL, or a Worktree ID. A URL names its own repository and wins over repo.",
  );
export const visibilityInput = z
  .enum(["private", "space"])
  .describe("Team Space repositories only.");

export const spaceFeature = (context: ToolContext) => new WorkspaceSpaceFeature(async () => context.http);
export const worktreeFeature = (context: ToolContext) =>
  new WorkspaceWorktreeFeature(async () => context.http);

/** Resolves a `pr` argument to its Worktree and the repository (Space ID) its Browser page lives in. */
export async function findPr(
  context: ToolContext,
  repo: string,
  number: string,
): Promise<{ readonly worktree: WorkspaceWorktree; readonly spaceId: string | null }> {
  const { worktree, spaceId } = await findPullRequest(
    worktreeFeature(context),
    number,
    async () => context.identityOrigin,
    async () => ({ spaceId: await resolveRepo(context, repo) }),
  );
  return { worktree, spaceId: (await pullSpaceId(spaceFeature(context), worktree, spaceId)) ?? null };
}

export function prWithUrl(
  context: ToolContext,
  worktree: WorkspaceWorktree,
  spaceId: string | null,
): WorkspaceWorktree & { readonly url: string } {
  return { ...worktree, url: pullUrl(context.identityOrigin, worktree, undefined, spaceId ?? undefined) };
}

/** Adds `url` to each Worktree, looking up each creator's Personal Space at most once. */
export async function prsWithUrl(
  context: ToolContext,
  worktrees: readonly WorkspaceWorktree[],
): Promise<readonly (WorkspaceWorktree & { readonly url: string })[]> {
  const spaces = spaceFeature(context);
  const lookups = new Map<string, Promise<WorkspaceSpace>>();
  const cached = {
    lookup: (owner: string, slug: string) => {
      const key = `${owner}/${slug}`;
      let found = lookups.get(key);
      if (found === undefined) lookups.set(key, (found = spaces.lookup(owner, slug)));
      return found;
    },
  };
  return await Promise.all(
    worktrees.map(async (worktree) => prWithUrl(context, worktree, (await pullSpaceId(cached, worktree)) ?? null)),
  );
}

/** Runs a lifecycle transition on the pull request a `repo` and `number` name and returns it with its `url`. */
export async function transitionPr(
  context: ToolContext,
  repo: string,
  number: string,
  action: "merge" | "discard",
) {
  const { worktree, spaceId } = await findPr(context, repo, number);
  const updated = await worktreeFeature(context).transition(worktree.id, action);
  return { output: prWithUrl(context, updated, spaceId), repo: spaceId };
}
