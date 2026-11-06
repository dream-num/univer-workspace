import { actorOf } from "./actor";
import { dayKeyOf } from "./days";
import type { ActivityEvent, DayWindow, Issue, IssueRef, PullRef, RepositoryActivity, WindowPage, Worktree } from "./types";

export function pullRef(worktree: Worktree, personalSpaceId: string | null = null): PullRef {
  return { id: worktree.id, number: worktree.number, title: worktree.name, spaceId: worktree.teamSpace?.id ?? personalSpaceId };
}

export function issueRef(issue: Issue): IssueRef {
  return { number: issue.number, title: issue.title, spaceId: issue.space.id };
}

export function buildRepositoryActivity(
  window: DayWindow,
  worktrees: WindowPage<Worktree>,
  issues: WindowPage<Issue>,
): RepositoryActivity {
  const buckets = new Map(window.days.map((day) => [day, { pulls: 0, issues: 0, merged: 0 }]));
  const events: ActivityEvent[] = [];
  for (const worktree of worktrees.items) {
    const pull = pullRef(worktree);
    const opened = buckets.get(dayKeyOf(worktree.createdAt));
    if (opened) {
      opened.pulls += 1;
      events.push({ kind: "pull-opened", at: worktree.createdAt, actor: actorOf(worktree.creator), pull });
    }
    if (worktree.state === "merged" && worktree.processedAt) {
      const merged = buckets.get(dayKeyOf(worktree.processedAt));
      if (merged) {
        merged.merged += 1;
        events.push({ kind: "pull-merged", at: worktree.processedAt, actor: actorOf(null), pull });
      }
    }
  }
  for (const item of issues.items) {
    const issue = issueRef(item);
    const opened = buckets.get(dayKeyOf(item.createdAt));
    if (opened) {
      opened.issues += 1;
      events.push({ kind: "issue-opened", at: item.createdAt, actor: actorOf(item.author), issue });
    }
    if (item.state === "closed" && item.closedAt && buckets.has(dayKeyOf(item.closedAt))) {
      events.push({ kind: "issue-closed", at: item.closedAt, actor: actorOf(item.closedBy), issue });
    }
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const complete = worktrees.complete && issues.complete;
  return {
    window,
    series: {
      days: [...buckets].map(([day, bucket]) => ({
        day,
        segments: [{ key: "pulls", value: bucket.pulls }, { key: "issues", value: bucket.issues }],
        total: bucket.pulls + bucket.issues,
        merged: bucket.merged,
      })),
      complete,
    },
    events: events.slice(0, 20),
    lastActivityAt: events[0]?.at ?? null,
    complete,
  };
}
