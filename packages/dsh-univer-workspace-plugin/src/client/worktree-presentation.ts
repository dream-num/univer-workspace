import type { WorktreeStatus } from "../shared/state.ts";
import type { UniverLocaleKey } from "./locales.ts";

/** Canonical Agent labels for the Workspace lifecycle; loading is not a lifecycle state. */
const statusKeys = {
  draft: "worktree.status.draft",
  ready: "worktree.status.ready",
  merging: "worktree.status.merging",
  merged: "worktree.status.merged",
  discarded: "worktree.status.discarded",
} as const satisfies Record<WorktreeStatus, UniverLocaleKey>;

export function worktreeStatusLabel(status: WorktreeStatus, t: (key: UniverLocaleKey) => string): string {
  return t(statusKeys[status]);
}
