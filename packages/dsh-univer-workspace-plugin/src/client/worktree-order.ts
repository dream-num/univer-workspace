import type { WorktreeStateView, WorktreeStatus } from "../shared/state.ts";

export type WorktreeVisibilityFilter = "open" | "all" | "closed";

export type WorktreeRelativeTimeKey =
  | "worktree.time.justNow"
  | "worktree.time.minutes"
  | "worktree.time.hours"
  | "worktree.time.days"
  | "worktree.time.weeks"
  | "worktree.time.months"
  | "worktree.time.years"
  | "worktree.time.unknown";

/**
 * Render the age of a Worktree without coupling the ordering module to React
 * or a specific locale implementation. The caller supplies the dictionary
 * lookup so the same row can follow the Harness language setting.
 */
export function formatWorktreeRelativeTime(
  createdAt: string,
  now: number,
  translate: (key: WorktreeRelativeTimeKey) => string,
): string {
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return translate("worktree.time.unknown");

  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 60_000) return translate("worktree.time.justNow");

  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes < 60) return replaceValue(translate("worktree.time.minutes"), ageMinutes);

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return replaceValue(translate("worktree.time.hours"), ageHours);

  const ageDays = Math.floor(ageHours / 24);
  if (ageDays < 7) return replaceValue(translate("worktree.time.days"), ageDays);

  const ageWeeks = Math.floor(ageDays / 7);
  if (ageDays < 30) return replaceValue(translate("worktree.time.weeks"), ageWeeks);

  const ageMonths = Math.floor(ageDays / 30);
  if (ageDays < 365) return replaceValue(translate("worktree.time.months"), ageMonths);

  return replaceValue(translate("worktree.time.years"), Math.floor(ageDays / 365));
}

function replaceValue(template: string, value: number): string {
  return template.replace("{value}", String(value));
}

export function isOpenWorktreeStatus(status: WorktreeStatus): boolean {
  return status === "draft" || status === "ready" || status === "merging";
}

export function worktreeMatchesVisibility(
  status: WorktreeStatus,
  filter: WorktreeVisibilityFilter,
): boolean {
  if (filter === "all") return true;
  return filter === "open" ? isOpenWorktreeStatus(status) : !isOpenWorktreeStatus(status);
}

/** Newest Worktrees first while retaining the server order for equal/invalid dates. */
export function sortWorktreesByCreatedAt(
  worktrees: readonly WorktreeStateView[],
): readonly WorktreeStateView[] {
  return worktrees
    .map((worktree, index) => ({ worktree, index, timestamp: Date.parse(worktree.createdAt) }))
    .sort((left, right) => {
      const leftTimestamp = Number.isNaN(left.timestamp)
        ? Number.NEGATIVE_INFINITY
        : left.timestamp;
      const rightTimestamp = Number.isNaN(right.timestamp)
        ? Number.NEGATIVE_INFINITY
        : right.timestamp;
      return rightTimestamp - leftTimestamp || left.index - right.index;
    })
    .map(({ worktree }) => worktree);
}
