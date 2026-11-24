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

// A model that sends 12 as a number reaches pull request 12, and any other non-string keeps the string error.
// The description sits on the string and nonoptional keeps it required, so the advertised schema stays main's.
export const pullNumberInput = z
  .preprocess(
    (value) => (Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : value),
    z
      .string()
      .describe(
        "Pull request number (12 or #12), its Workspace URL, or a Worktree ID. A URL names its own repository and wins over repo.",
      ),
  )
  .nonoptional();
export const issueLinkInput = z
  .number()
  .int()
  .positive()
  .describe("Number of the Issue in the same repository that this pull request serves. Team Space repositories only.");
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
  const worktrees = worktreeFeature(context);
  const updated = await worktrees.transition(worktree.id, action);
  // The merge response is a summary without Units; read them back to report what entered trunk.
  const result = action === "merge" ? await worktrees.get(worktree.id) : updated;
  return { output: prWithUrl(context, result, spaceId), repo: spaceId };
}
