import { describe, expect, it } from "vitest";
import { activityDays, activityWindow, summarizeActivity } from "../../server/src/modules/activity/activity.service.js";
import type { IssueActivity } from "../../server/src/modules/issues/index.js";
import type { WorktreeActivity } from "../../server/src/modules/worktrees/index.js";

const actor = { id: "u", username: "user", displayName: "User", avatarUrl: null };
const at = Date.parse("2026-11-01T04:00:00Z");
const pull: WorktreeActivity = { id: "w", number: 1, name: "Pull", creator: actor, createdVia: "browser", createdAt: at, mergedAt: at + 1 };
const issue: IssueActivity = { number: 2, title: "Issue", author: actor, createdVia: "agent", createdAt: at, closedAt: at + 2, closedBy: actor };

describe("Repository activity calendar", () => {
  it("returns 14 consecutive keys across month end and leap day", () => {
    expect(activityDays("2024-03-02")).toEqual([
      "2024-02-18", "2024-02-19", "2024-02-20", "2024-02-21", "2024-02-22", "2024-02-23", "2024-02-24",
      "2024-02-25", "2024-02-26", "2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-02",
    ]);
    expect(activityDays("2026-11-01")).toHaveLength(14);
    expect(activityDays("2026-11-01")[0]).toBe("2026-10-19");
  });

  it("uses local midnight and both occurrences of the DST end hour", () => {
    const window = activityWindow("America/New_York", Date.parse("2026-11-01T23:00:00Z"));
    expect(window.dayOf(at - 1)).toBe("2026-10-31");
    expect(window.dayOf(at)).toBe("2026-11-01");
    expect(window.dayOf(Date.parse("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(window.dayOf(Date.parse("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
    expect(window.days.at(-1)).toBe("2026-11-01");
  });

  it("handles Pacific/Kiritimati and returns canonical zone names", () => {
    const window = activityWindow("Pacific/Kiritimati", Date.parse("2026-10-31T10:00:00Z"));
    expect(window.dayOf(Date.parse("2026-10-31T09:59:59.999Z"))).toBe("2026-10-31");
    expect(window.days.at(-1)).toBe("2026-11-01");
    expect(activityWindow("US/Eastern", at).timeZone).toBe("America/New_York");
    expect(activityWindow("UTC", at).timeZone).toBe("UTC");
  });

  it.each([undefined, null, [], 1, "", " ", "+01:00", "Bad/Zone", "GMT", "a".repeat(65)])("rejects invalid time zone %j", (value) => {
    expect(() => activityWindow(value, at)).toThrow(expect.objectContaining({ code: "INVALID_INPUT", status: 400, field: "timeZone" }));
  });
});

describe("Repository activity facts", () => {
  const window = activityWindow("America/New_York", at);
  const summarize = (worktrees: readonly WorktreeActivity[], issues: readonly IssueActivity[] = []) =>
    summarizeActivity({ spaceId: "space", ...window, worktrees, issues });

  it("zero-fills days, counts by creation source and drops facts outside the window", () => {
    const result = summarize([
      pull,
      { ...pull, id: "unknown", createdVia: null, mergedAt: null },
      { ...pull, id: "old", createdAt: at - 30 * 86_400_000, mergedAt: null },
      { ...pull, id: "future", createdAt: at + 2 * 86_400_000, mergedAt: null },
    ], [issue]);
    expect(result.days).toHaveLength(14);
    expect(result.days[0]).toEqual({ day: "2026-10-19", opened: { browser: 0, agent: 0, unknown: 0 }, merged: 0 });
    expect(result.days.at(-1)).toEqual({ day: "2026-11-01", opened: { browser: 1, agent: 1, unknown: 1 }, merged: 1 });
    expect(result.events.map((event) => event.kind)).toEqual(["issue-closed", "pull-merged", "issue-opened", "pull-opened", "pull-opened"]);
    expect(result.events[0]).toMatchObject({ actor, writeSource: "unknown", issue: { spaceId: "space" } });
    expect(result.events[1]).toMatchObject({ actor: null, writeSource: "unknown", pull: { spaceId: "space" } });
    expect(summarize([], []).days.every((day) => day.merged === 0 && Object.values(day.opened).every((count) => count === 0))).toBe(true);
  });

  it("keeps the newest 20 events, with deterministic ties", () => {
    const pulls = Array.from({ length: 25 }, (_, index) => ({ ...pull, id: `w${index}`, createdAt: at + index, mergedAt: null }));
    const result = summarize(pulls);
    expect(result.events).toHaveLength(20);
    expect(result.events.map((event) => event.at)).toEqual(pulls.slice(5).reverse().map((item) => new Date(item.createdAt).toISOString()));
    expect(result.days.at(-1)?.opened.browser).toBe(25);
    expect(summarize([pull, { ...pull, id: "a" }])).toEqual(summarize([{ ...pull, id: "a" }, pull]));
  });
});
