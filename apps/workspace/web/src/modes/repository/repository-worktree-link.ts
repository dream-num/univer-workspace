import type { components } from "../../../../generated/http/schema.js";

export function repositoryWorktreeSearch(
  worktree: components["schemas"]["WorktreeSummary"],
  personalSpaceId?: string,
) {
  if (!worktree.capabilities.review) return undefined;
  const spaceId = worktree.kind === "team" ? worktree.teamSpace?.id : personalSpaceId;
  return { worktree: worktree.id, ...(spaceId ? { spaceId } : {}) };
}
