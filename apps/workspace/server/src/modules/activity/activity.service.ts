import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import { writeSourceView, type WriteSourceView } from "../identity/index.js";
import type { IssueActivity, IssuesModule } from "../issues/index.js";
import type { PublicUser } from "../permissions/index.js";
import type { WorktreeActivity, WorktreesModule } from "../worktrees/index.js";

const DAY_MS = 86_400_000;
const ACTIVITY_DAYS = 14;
const FETCH_MARGIN_DAYS = 2;

export type ActivityEvent = {
  readonly at: string;
  readonly actor: PublicUser | null;
  readonly writeSource: WriteSourceView;
} & (
  | { readonly kind: "pull-opened" | "pull-merged";
      readonly pull: { readonly id: string; readonly number: number | null; readonly title: string; readonly spaceId: string } }
  | { readonly kind: "issue-opened" | "issue-closed";
      readonly issue: { readonly number: number; readonly title: string; readonly spaceId: string } }
);

export interface RepositoryActivity {
  readonly timeZone: string;
  readonly days: readonly {
    readonly day: string;
    readonly opened: Readonly<Record<WriteSourceView, number>>;
    readonly merged: number;
  }[];
  readonly events: readonly ActivityEvent[];
  readonly complete: boolean;
}

export interface ActivityModule {
  get(userId: string, spaceId: string, query: { readonly timeZone: unknown }): Promise<RepositoryActivity>;
}

export function createActivityModule(options: {
  readonly access: AccessResolver;
  readonly worktrees: WorktreesModule;
  readonly issues: IssuesModule;
  readonly now?: () => number;
}): ActivityModule {
  return {
    async get(userId, spaceId, query) {
      const window = activityWindow(query.timeZone, (options.now ?? Date.now)());
      const space = options.access.resolveSpace(userId, spaceId);
      if (!space || (space.type === "personal" && space.ownerUserId !== userId)) {
        throw new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
      }
      const issues = space.type === "team"
        ? options.issues.activity(userId, spaceId, window.since)
        : { items: [], complete: true };
      const pulls = await options.worktrees.activity(userId, space.type === "team"
        ? { kind: "team", teamSpaceId: spaceId } : { kind: "user" }, window.since);
      return {
        timeZone: window.timeZone,
        ...summarizeActivity({ spaceId, days: window.days, dayOf: window.dayOf, worktrees: pulls.items, issues: issues.items }),
        complete: pulls.complete && issues.complete,
      };
    },
  };
}

export function activityWindow(value: unknown, now: number) {
  const invalid = () => new ApplicationError("INVALID_INPUT", 400, "A valid IANA time zone is required.", "timeZone");
  if (typeof value !== "string" || value.length < 1 || value.length > 64 ||
      !/^(UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(value)) throw invalid();
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: value, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    throw invalid();
  }
  const dayOf = (at: number): string => {
    const parts = formatter.formatToParts(at);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  return {
    timeZone: formatter.resolvedOptions().timeZone,
    days: activityDays(dayOf(now)),
    dayOf,
    since: now - (ACTIVITY_DAYS + FETCH_MARGIN_DAYS) * DAY_MS,
  };
}

export function activityDays(today: string): readonly string[] {
  const date = new Date(`${today}T00:00:00.000Z`);
  return Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(date.getUTCDate() - (ACTIVITY_DAYS - 1) + index);
    return day.toISOString().slice(0, 10);
  });
}

export function summarizeActivity(input: {
  readonly spaceId: string;
  readonly days: readonly string[];
  readonly dayOf: (at: number) => string;
  readonly worktrees: readonly WorktreeActivity[];
  readonly issues: readonly IssueActivity[];
}): Pick<RepositoryActivity, "days" | "events"> {
  const buckets = new Map(input.days.map((day) => [day, { day, opened: { browser: 0, agent: 0, unknown: 0 }, merged: 0 }]));
  const events: ActivityEvent[] = [];
  for (const worktree of input.worktrees) {
    const pull = { id: worktree.id, number: worktree.number, title: worktree.name, spaceId: input.spaceId };
    const opened = buckets.get(input.dayOf(worktree.createdAt));
    const writeSource = writeSourceView(worktree.createdVia);
    if (opened) {
      opened.opened[writeSource] += 1;
      events.push({ kind: "pull-opened", at: new Date(worktree.createdAt).toISOString(), actor: worktree.creator, writeSource, pull });
    }
    if (worktree.mergedAt !== null) {
      const merged = buckets.get(input.dayOf(worktree.mergedAt));
      if (merged) {
        merged.merged += 1;
        events.push({ kind: "pull-merged", at: new Date(worktree.mergedAt).toISOString(), actor: null, writeSource: "unknown", pull });
      }
    }
  }
  for (const item of input.issues) {
    const issue = { number: item.number, title: item.title, spaceId: input.spaceId };
    const opened = buckets.get(input.dayOf(item.createdAt));
    const writeSource = writeSourceView(item.createdVia);
    if (opened) {
      opened.opened[writeSource] += 1;
      events.push({ kind: "issue-opened", at: new Date(item.createdAt).toISOString(), actor: item.author, writeSource, issue });
    }
    if (item.closedAt !== null && buckets.has(input.dayOf(item.closedAt))) {
      events.push({ kind: "issue-closed", at: new Date(item.closedAt).toISOString(), actor: item.closedBy, writeSource: "unknown", issue });
    }
  }
  const eventKey = (event: ActivityEvent) => `${event.kind}:${"pull" in event ? event.pull.id : event.issue.number}`;
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || eventKey(a).localeCompare(eventKey(b)));
  return { days: [...buckets.values()], events: events.slice(0, 20) };
}
