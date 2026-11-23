import type { SpaceView } from "../spaces/index.js";
import type { WorktreeSummary } from "../worktrees/index.js";

export type ForkState = "clean" | "drafting" | "proposed" | "merging";

export interface ForkView {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  readonly owner: { readonly id: string; readonly username: string };
  readonly upstream: SpaceView | null;
  readonly state: ForkState;
  readonly worktree: WorktreeSummary | null;
  readonly createdAt: string;
}
