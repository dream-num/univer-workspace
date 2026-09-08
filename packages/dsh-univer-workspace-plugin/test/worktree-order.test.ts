import { describe, expect, it } from "vitest";
import {
  formatWorktreeRelativeTime,
  sortWorktreesByCreatedAt,
  worktreeMatchesVisibility,
} from "../src/client/worktree-order.ts";
import { en, zh } from "../src/client/locales.ts";
import type { WorktreeStateView } from "../src/shared/state.ts";

function worktree(id: string, createdAt: string): WorktreeStateView {
  return { worktreeId: id, createdAt } as unknown as WorktreeStateView;
}

describe("Worktree sidebar ordering", () => {
  it("orders each status group newest-first", () => {
    expect(
      sortWorktreesByCreatedAt([
        worktree("old", "2026-09-01T00:00:00Z"),
        worktree("new", "2026-09-04T00:00:00Z"),
      ]).map(({ worktreeId }) => worktreeId),
    ).toEqual(["new", "old"]);
  });

  it("keeps server order for equal and invalid timestamps", () => {
    expect(
      sortWorktreesByCreatedAt([
        worktree("first", "not-a-date"),
        worktree("second", "not-a-date"),
        worktree("older", "2026-09-01T00:00:00Z"),
      ]).map(({ worktreeId }) => worktreeId),
    ).toEqual(["older", "first", "second"]);
  });
});

describe("Worktree sidebar visibility", () => {
  it("defaults to open worktrees while allowing all or closed-only views", () => {
    expect(worktreeMatchesVisibility("draft", "open")).toBe(true);
    expect(worktreeMatchesVisibility("merged", "open")).toBe(false);
    expect(worktreeMatchesVisibility("discarded", "all")).toBe(true);
    expect(worktreeMatchesVisibility("merged", "closed")).toBe(true);
    expect(worktreeMatchesVisibility("draft", "closed")).toBe(false);
  });
});

describe("Worktree sidebar relative time", () => {
  it("uses the real zh/en dictionaries and a safe fallback", () => {
    const now = Date.parse("2026-09-04T12:00:00Z");
    const translateZh = (key: keyof typeof zh) => zh[key];
    const translateEn = (key: keyof typeof en) => en[key];
    expect(formatWorktreeRelativeTime("2026-09-04T11:55:00Z", now, translateZh)).toBe(
      zh["worktree.time.minutes"].replace("{value}", "5"),
    );
    expect(formatWorktreeRelativeTime("2026-09-04T09:00:00Z", now, translateZh)).toBe(
      zh["worktree.time.hours"].replace("{value}", "3"),
    );
    expect(formatWorktreeRelativeTime("2026-09-04T11:59:50Z", now, translateZh)).toBe(
      zh["worktree.time.justNow"],
    );
    expect(formatWorktreeRelativeTime("2026-09-04T11:55:00Z", now, translateEn)).toBe(
      "5 minutes ago",
    );
    expect(formatWorktreeRelativeTime("not-a-date", now, translateZh)).toBe(
      zh["worktree.time.unknown"],
    );
    expect(formatWorktreeRelativeTime("not-a-date", now, translateEn)).toBe("Time unavailable");
  });
});
