import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceNavigationStore,
  reduceWorkspaceNavigation,
  resolveWorkspaceOverlaySurface,
  workspaceNavigationModeOf,
  type WorkspaceContentSurface,
  type WorkspaceNavigationState,
} from "../src/client/navigation/workspace-navigation.ts";

const resource: WorkspaceContentSurface = {
  kind: "resource",
  workspaceOrigin: "https://workspace.example",
  resourceId: "resource-1",
  docKey: "res:resource-1",
  name: "Budget",
  unitType: "sheet",
};

const worktree: WorkspaceContentSurface = {
  kind: "worktree",
  workspaceOrigin: "https://workspace.example",
  worktreeId: "worktree-1",
  name: "Prepare budget review",
  unitId: "unit-1",
};

const initial: WorkspaceNavigationState = {
  navigationMode: "sessions",
  contentSurface: null,
};

describe("Workspace navigation state", () => {
  it.each([
    ["sessions", "sessions"],
    ["files", "files"],
    ["worktrees", "worktrees"],
    ["unknown", "sessions"],
    [null, "sessions"],
  ] as const)("reads the stored navigation mode %s as %s", (stored, expected) => {
    expect(workspaceNavigationModeOf(stored)).toBe(expected);
  });

  it.each(["sessions", "files", "worktrees"] as const)(
    "changes only the left navigation mode to %s",
    (navigationMode) => {
      const state = { ...initial, contentSurface: resource };

      expect(
        reduceWorkspaceNavigation(state, {
          type: "select-navigation",
          navigationMode,
        }),
      ).toEqual({ navigationMode, contentSurface: resource });
    },
  );

  it("opens a Resource without changing the left navigation mode", () => {
    expect(
      reduceWorkspaceNavigation(
        { ...initial, navigationMode: "files" },
        { type: "open-content", contentSurface: resource },
      ),
    ).toEqual({ navigationMode: "files", contentSurface: resource });
  });

  it("replaces a Resource with a Worktree without changing the left navigation mode", () => {
    expect(
      reduceWorkspaceNavigation(
        { navigationMode: "worktrees", contentSurface: resource },
        { type: "open-content", contentSurface: worktree },
      ),
    ).toEqual({ navigationMode: "worktrees", contentSurface: worktree });
  });

  it("keeps a Worktree surface for the middle workspace renderer", () => {
    expect(resolveWorkspaceOverlaySurface(worktree)).toEqual(worktree);
  });

  it("updates the active Unit inside the same Worktree surface", () => {
    const next = { ...worktree, unitId: "unit-2" };

    expect(
      reduceWorkspaceNavigation(
        { navigationMode: "worktrees", contentSurface: worktree },
        { type: "open-content", contentSurface: next },
      ),
    ).toEqual({ navigationMode: "worktrees", contentSurface: next });
  });

  it("closes only the middle content surface", () => {
    expect(
      reduceWorkspaceNavigation(
        { navigationMode: "sessions", contentSurface: worktree },
        { type: "close-content" },
      ),
    ).toEqual({ navigationMode: "sessions", contentSurface: null });
  });

  it("does not model or mutate the current DSH Session", () => {
    expect(Object.keys(initial).sort()).toEqual(["contentSurface", "navigationMode"]);
  });

  it("publishes real changes once and ignores equivalent intents", () => {
    const store = createWorkspaceNavigationStore(initial);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.dispatch({ type: "select-navigation", navigationMode: "files" });
    store.dispatch({ type: "select-navigation", navigationMode: "files" });
    store.dispatch({ type: "open-content", contentSurface: resource });
    store.dispatch({ type: "open-content", contentSurface: { ...resource } });
    store.dispatch({ type: "close-content" });
    store.dispatch({ type: "close-content" });

    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot()).toEqual({ navigationMode: "files", contentSurface: null });

    unsubscribe();
    store.dispatch({ type: "select-navigation", navigationMode: "sessions" });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
