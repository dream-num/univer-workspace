import type { components } from "../../../../generated/http/schema.js";

type SpaceView = components["schemas"]["SpaceView"];
type WorktreeSummary = components["schemas"]["WorktreeSummary"];
type WorktreeState = components["schemas"]["WorktreeState"];

export const OPEN_WORKTREE_STATES: readonly WorktreeState[] = ["draft", "ready", "merging"];

export function isOpenWorktree(state: WorktreeState): boolean {
  return OPEN_WORKTREE_STATES.includes(state);
}

/**
 * Team Worktree 归属其 Team Space；个人 Worktree 归属创建者的个人 Space。
 */
export function worktreeBelongsToSpace(
  worktree: Pick<WorktreeSummary, "kind" | "teamSpace" | "creator">,
  space: Pick<SpaceView, "id" | "type" | "owner">
): boolean {
  return space.type === "team"
    ? worktree.teamSpace?.id === space.id
    : worktree.kind === "user" && worktree.creator.id === space.owner.id;
}
