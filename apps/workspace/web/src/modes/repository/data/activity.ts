import { actorOf, kindCounts, segmentsOf } from "./actor";
import { asDayKey } from "./days";
import type { ActivityEvent, Issue, IssueRef, PullRef, RepositoryActivity, WireActivity, Worktree } from "./types";

export function pullRef(worktree: Worktree, personalSpaceId: string | null = null): PullRef {
  return { id: worktree.id, number: worktree.number, title: worktree.name, spaceId: worktree.teamSpace?.id ?? personalSpaceId };
}

export function issueRef(issue: Issue): IssueRef {
  return { number: issue.number, title: issue.title, spaceId: issue.space.id };
}

export function parseRepositoryActivity(wire: WireActivity): RepositoryActivity {
  const events: ActivityEvent[] = wire.events.map((event) => "pull" in event
    ? { kind: event.kind, at: event.at, actor: actorOf(event.actor, event.writeSource), pull: event.pull }
    : { kind: event.kind, at: event.at, actor: actorOf(event.actor, event.writeSource), issue: event.issue });
  return {
    series: {
      days: wire.days.map((day) => {
        const segments = segmentsOf(kindCounts(day.opened));
        return { day: asDayKey(day.day), segments, total: segments.reduce((sum, segment) => sum + segment.value, 0), merged: day.merged };
      }),
      complete: wire.complete,
    },
    events,
    lastActivityAt: events[0]?.at ?? null,
    complete: wire.complete,
  };
}
