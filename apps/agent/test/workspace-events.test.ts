import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceEvents } from "../src/workspace-events.ts";
import type { WorkspaceAuthProvider } from "../src/workspace-auth-provider.ts";
import { parseWorkspaceChange } from "../src/workspace-events-contract.ts";

const feed = vi.hoisted(() => ({ changed: undefined as (() => void) | undefined, stop: vi.fn() }));
vi.mock("../src/workspace-change-feed.ts", () => ({
  subscribeWorkspaceChanges: (_client: unknown, changed: () => void) => {
    feed.changed = changed;
    return feed.stop;
  },
}));

describe("Workspace Remote feed", () => {
  it("shares one upstream feed, sends a baseline to each subscriber, coalesces changes and cancels readers", async () => {
    const ctx = new Context();
    const register = vi.fn();
    ctx.provide("typert", { register });
    const auth = {
      currentClient: () => ({}),
      connectionVersion: () => "account-a",
    } as unknown as WorkspaceAuthProvider;
    const service = new WorkspaceEvents(ctx, auth);
    const a = new AbortController();
    const b = new AbortController();
    const first = service.follow(a.signal);
    const second = service.follow(b.signal);
    expect(service.typertRemote.serviceKey).toBe("workspaceEvents");
    expect(register).toHaveBeenCalledOnce();
    expect((await first.next()).value).toEqual({ version: "account-a", revision: 0 });
    expect((await second.next()).value).toEqual({ version: "account-a", revision: 0 });
    const nextA = first.next();
    const nextB = second.next();
    feed.changed!();
    feed.changed!();
    expect((await nextA).value).toEqual({ version: "account-a", revision: 1 });
    expect((await nextB).value).toEqual({ version: "account-a", revision: 1 });
    const pending = first.next();
    a.abort();
    expect((await pending).done).toBe(true);
    b.abort();
    expect((await second.next()).done).toBe(true);
  });

  it("rejects malformed invalidation payloads", () => {
    for (const value of [null, {}, { version: "a", revision: -1 }, { version: "", revision: 0 }]) {
      expect(() => parseWorkspaceChange(value)).toThrow();
    }
  });
});
