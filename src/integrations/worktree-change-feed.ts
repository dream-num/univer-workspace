/**
 * Worktree change-feed contract shared by the edge gateway and ChatAgent DO.
 * Browser clients open `/api/worktree-events` with a one-time session ticket
 * minted at `/universer-api/user/session-ticket`.
 */
export const WORKTREE_CHANGE_FEED_PATH = "/api/worktree-events";
export const WORKTREE_CHANGE_NOTIFY_PATH = "/internal/worktrees-changed";

export const WORKTREE_CHANGE_FEED_READY = {
  event: "worktreeChangeFeedReady",
} as const;

export const WORKTREES_CHANGED = {
  event: "worktreesChanged",
} as const;

export function isWorktreeMutation(pathname: string, method: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "POST" && pathname === "/api/worktrees") return true;
  if (verb === "POST" && /^\/api\/worktrees\/[^/]+\/discard$/.test(pathname)) return true;
  return false;
}
