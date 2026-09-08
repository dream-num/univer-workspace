import { describe, expect, it, vi } from "vitest";
import {
  bindContentRoute,
  contentRegion,
  parseContentRegion,
  regionQuery,
  setConversationHidden,
  setRegion,
} from "../src/client/navigation/region-route.ts";
import {
  createWorkspaceNavigationStore,
  type WorkspaceContentSurface,
} from "../src/client/navigation/workspace-navigation.ts";

const surface: WorkspaceContentSurface = {
  kind: "worktree",
  worktreeId: "one/id",
  name: "Review",
  workspaceOrigin: "https://workspace.example",
  unitId: "unit 1",
};

describe("independent region routes", () => {
  it("roundtrips encoded ids, accepts legacy sessions and rejects malformed targets", () => {
    expect(parseContentRegion(contentRegion(surface))).toEqual({
      kind: "worktree",
      id: "one/id",
      unitId: "unit 1",
    });
    expect(regionQuery("#/s/a%2Fb").get("right")).toBe("session/a%2Fb");
    for (const value of ["worktree/", "resource/a/extra", "worktree/%ZZ", "worktree/a/unit/"])
      expect(parseContentRegion(value)).toBeNull();
  });

  it("retains the selected session and center when hiding and expanding", () => {
    vi.stubGlobal("window", { location: { hash: "#/?center=resource%2Fa&right=session%2Fb" } });
    try {
      setConversationHidden(true, "session/one");
      expect(regionQuery(window.location.hash).get("right")).toBe("hidden/session/session%2Fone");
      expect(regionQuery(window.location.hash).get("center")).toBe("resource/a");
      setConversationHidden(false, "session/one");
      expect(regionQuery(window.location.hash).get("right")).toBe("session/session%2Fone");
      expect(regionQuery(window.location.hash).get("center")).toBe("resource/a");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes either region without discarding the other", () => {
    vi.stubGlobal("window", { location: { hash: "#/?center=resource%2Fa&right=session%2Fb" } });
    try {
      setRegion("right", null);
      expect(regionQuery(window.location.hash).get("center")).toBe("resource/a");
      expect(regionQuery(window.location.hash).has("right")).toBe(false);
      setRegion("center", null);
      expect(window.location.hash).toBe("#/");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not reopen content when an earlier metadata request completes after close", async () => {
    const events = new Map<string, () => void>();
    vi.stubGlobal("window", {
      location: { hash: "#/?center=worktree%2Fa" },
      addEventListener: (key: string, fn: () => void) => events.set(key, fn),
      removeEventListener: vi.fn(),
    });
    try {
      const store = createWorkspaceNavigationStore();
      let finish!: (surface: WorkspaceContentSurface) => void;
      const stop = bindContentRoute(
        store,
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        vi.fn(),
      );
      window.location.hash = "#/";
      events.get("hashchange")!();
      finish(surface);
      await Promise.resolve();
      expect(store.getSnapshot().contentSurface).toBeNull();
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
