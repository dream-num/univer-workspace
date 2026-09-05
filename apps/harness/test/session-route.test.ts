import { describe, expect, it, vi } from "vitest";
import type { ClientContext } from "../src/client/dsh-runtime-types.ts";
import {
  SESSION_HASH_PREFIX,
  sessionHashForId,
  sessionIdFromHash,
  apply,
} from "../src/client/session-route.js";

describe("Workspace Harness session URL", () => {
  it("encodes a session id in the canonical hash route", () => {
    expect(sessionHashForId("session/with spaces")).toBe("#/s/session%2Fwith%20spaces");
    expect(SESSION_HASH_PREFIX).toBe("#/s/");
  });

  it("decodes only the session route prefix", () => {
    expect(sessionIdFromHash("#/s/session%2Fwith%20spaces")).toBe("session/with spaces");
    expect(sessionIdFromHash("#/workspace/space-1")).toBeUndefined();
    expect(sessionIdFromHash("#/s/%E0%A4%A")).toBeUndefined();
    expect(sessionIdFromHash("#/s/")).toBeUndefined();
  });

  it("projects a native current session into the hash in the same notification", () => {
    const sessionId = "session-created";
    const otherSessionId = "session-sidebar-target";
    let snapshot = {
      ids: [sessionId, otherSessionId],
      byId: {
        [sessionId]: { id: sessionId, cwd: "/account/root" },
        [otherSessionId]: { id: otherSessionId, cwd: "/account/root" },
      },
      current: undefined as string | undefined,
      phase: "ready" as const,
    };
    const listeners = new Set<() => void>();
    const list = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const sessions = {
      list,
      open: vi.fn((id: string) => {
        snapshot = { ...snapshot, current: id };
        for (const listener of listeners) listener();
      }),
    };
    const events = new Map<string, EventListener>();
    vi.stubGlobal("window", {
      location: { hash: "" },
      addEventListener: (name: string, listener: EventListener) => events.set(name, listener),
      removeEventListener: (name: string) => events.delete(name),
    });
    const ctx = {
      sessions,
      effect: (factory: () => unknown) => factory(),
    } as unknown as ClientContext;

    try {
      apply(ctx);
      snapshot = { ...snapshot, current: sessionId };
      for (const listener of listeners) listener();
      expect(window.location.hash).toBe(sessionHashForId(sessionId));
      expect(sessions.open).not.toHaveBeenCalled();

      // A native sidebar click changes `current` before the browser emits a
      // hash event. The route must project the new id instead of reopening the
      // stale hash target.
      snapshot = { ...snapshot, current: otherSessionId };
      for (const listener of listeners) listener();
      expect(window.location.hash).toBe(sessionHashForId(otherSessionId));

      // Conversely, an explicit deep-link navigation opens the listed row.
      window.location.hash = sessionHashForId(sessionId);
      events.get("hashchange")?.(new Event("hashchange"));
      expect(sessions.open).toHaveBeenCalledWith(sessionId);
      expect(window.location.hash).toBe(sessionHashForId(sessionId));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not let an unlisted hash suppress a native selection", () => {
    const listedId = "session-listed";
    const staleId = "session-not-in-account-list";
    let snapshot = {
      ids: [listedId],
      byId: { [listedId]: { id: listedId, cwd: "/account/root" } },
      current: undefined as string | undefined,
      phase: "ready" as const,
    };
    const listeners = new Set<() => void>();
    const sessions = {
      list: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      open: vi.fn((id: string) => {
        snapshot = { ...snapshot, current: id };
        for (const listener of listeners) listener();
      }),
    };
    const events = new Map<string, EventListener>();
    vi.stubGlobal("window", {
      location: { hash: sessionHashForId(staleId) },
      addEventListener: (name: string, listener: EventListener) => events.set(name, listener),
      removeEventListener: (name: string) => events.delete(name),
    });
    const ctx = {
      sessions,
      effect: (factory: () => unknown) => factory(),
    } as unknown as ClientContext;

    try {
      apply(ctx);
      // The stale hash is retained while the account list is incomplete. Once
      // the native baseline/action selects a listed row, it must be projected.
      snapshot = { ...snapshot, current: listedId };
      for (const listener of listeners) listener();
      expect(sessions.open).not.toHaveBeenCalled();
      expect(window.location.hash).toBe(sessionHashForId(listedId));
      expect(events.has("hashchange")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
