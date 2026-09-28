import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeDashboard } from "./worktree-dashboard";

const state = vi.hoisted(() => ({
  active: {} as Record<string, unknown>,
  processed: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "spaces"
      ? { data: { spaces: [] } }
      : queryKey[2] === "active" ? state.active : state.processed,
  useQueries: () => [],
}));
vi.mock("../../shared/i18n", () => ({
  useI18n: () => ({ language: "en-US", t: (key: string) => key }),
}));
vi.mock("../../shared/resizable-sidebar", () => ({
  useMediaQuery: () => false,
  useResizableSidebar: () => ({ collapsed: false, width: 300 }),
  SidebarResizeHandle: () => null,
}));
vi.mock("./worktree-review-panel", () => ({
  UnitChangeIcon: () => null,
  UnitTypeIcon: () => null,
  WorktreeReviewPanel: () => null,
  worktreeStateLabel: () => "draft",
  worktreeStateVariant: () => "default",
}));

function list(hasCreatedWorktree: boolean, items: unknown[] = []) {
  return {
    isSuccess: true,
    isPending: false,
    data: { items, nextCursor: null, hasCreatedWorktree },
  };
}

beforeEach(() => {
  state.active = list(false);
  state.processed = list(false);
  vi.stubGlobal("window", { location: { origin: "https://workspace.example.test" } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Worktree dashboard onboarding", () => {
  it("shows the guide only after both lists confirm no creation history or visible tasks", () => {
    const html = renderToStaticMarkup(createElement(WorktreeDashboard));
    expect(html).toContain("onboardingTitle");
    expect(html).toContain("https://workspace.example.test");
    expect(html).toContain('https://github.com/dream-num/univer-workspace/releases"');
    expect(html).toContain("npx skills add dream-num/univer-workspace");
    expect(html).not.toContain("taskList");
  });

  it("does not flash the guide or empty state while loading, or mask an error", () => {
    state.processed = { isPending: true, isSuccess: false };
    const html = renderToStaticMarkup(createElement(WorktreeDashboard));
    expect(html).toContain("onboardingLoading");
    expect(html).not.toContain("onboardingTitle");
    expect(html).not.toContain("tasksCreatedByAgents");
    state.processed = { error: new Error("List unavailable") };
    expect(() => renderToStaticMarkup(createElement(WorktreeDashboard))).toThrow(
      "List unavailable",
    );
  });

  it("keeps prior creators, searches and explicit document links out of the full guide", () => {
    state.processed = list(true);
    expect(renderToStaticMarkup(createElement(WorktreeDashboard))).not.toContain("onboardingTitle");
    state.processed = list(false);
    const search = renderToStaticMarkup(
      createElement(WorktreeDashboard, { searchQuery: "missing" }),
    );
    expect(search).not.toContain("onboardingTitle");
    expect(search).toContain("noMatchingTasks");
    const linked = renderToStaticMarkup(
      createElement(WorktreeDashboard, { selectedWorktreeId: "missing" }),
    );
    expect(linked).not.toContain("onboardingTitle");
    expect(linked).toContain("workbenchSelectionUnavailable");
  });

  it("keeps team tasks visible with a compact introduction for non-creators", () => {
    state.active = list(false, [
      {
        id: "team-task",
        name: "Team analysis",
        summary: null,
        state: "draft",
        kind: "team",
        creator: { displayName: "Teammate", username: "teammate" },
        teamSpace: { name: "Team" },
        updatedAt: "2026-09-28T10:00:00Z",
      },
    ]);
    const html = renderToStaticMarkup(createElement(WorktreeDashboard));
    expect(html).toContain("Team analysis");
    expect(html).toContain("onboardingTeamHint");
    expect(html).not.toContain("onboardingTitle");
    const filtered = renderToStaticMarkup(
      createElement(WorktreeDashboard, { searchQuery: "missing" }),
    );
    expect(filtered).toContain("noMatchingTasks");
    expect(filtered).not.toContain("onboardingTitle");
  });
});
