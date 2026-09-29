import type { components } from "../../../../generated/http/schema.js";

type SpaceView = components["schemas"]["SpaceView"];
type WorktreeSummary = components["schemas"]["WorktreeSummary"];

/**
 * GitHub-style repositories map 1:1 onto Spaces. A Team Worktree belongs to a
 * Space through its team space, while a personal Worktree has no `teamSpace`
 * and belongs to the signed-in User's personal Space.
 */
export function worktreeBelongsToSpace(
  worktree: Pick<WorktreeSummary, "kind" | "teamSpace">,
  space: Pick<SpaceView, "id" | "type">
): boolean {
  return space.type === "team"
    ? worktree.teamSpace?.id === space.id
    : worktree.kind === "user";
}
