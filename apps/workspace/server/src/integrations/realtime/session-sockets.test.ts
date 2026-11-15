import { afterEach, expect, it, vi } from "vitest";
import { createSessionSockets } from "./session-sockets.js";

const connection = () => ({ id: "socket", customData: {}, send: vi.fn(), close: vi.fn() });

const ticket = (sessionId: string, ttl: number) => ({
  userID: "user", customData: { sessionId, sessionExpiresAt: Date.now() + ttl },
});

afterEach(() => vi.useRealTimers());

it("releases timers on untrack and closes only the selected session", async () => {
  vi.useFakeTimers();
  const registry = createSessionSockets(async () => true);
  const removed = connection();
  const revoked = connection();
  const other = connection();
  await registry.track(ticket("session", 1000), removed);
  await registry.track(ticket("session", 1000), revoked);
  await registry.track(ticket("other", 2000), other);
  registry.untrack(removed);
  registry.untrack(removed);
  registry.closeSessions(["session", "session"]);
  expect(revoked.close).toHaveBeenCalledExactlyOnceWith(1008, "Workspace session ended");
  expect(removed.close).not.toHaveBeenCalled();
  expect(other.close).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(2000);
  expect(other.close).toHaveBeenCalledExactlyOnceWith(1008, "Workspace session ended");
  expect(removed.close).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("supports session lifetimes above Node's maximum timer delay without closing early", async () => {
  vi.useFakeTimers();
  const registry = createSessionSockets(async () => true);
  const socket = connection();
  const lifetime = 30 * 24 * 60 * 60 * 1000;
  await registry.track(ticket("session", lifetime), socket);
  vi.advanceTimersByTime(lifetime - 1);
  expect(socket.close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(socket.close).toHaveBeenCalledExactlyOnceWith(1008, "Workspace session ended");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps queued messages unauthorized while checking, even if an old successful lookup follows revocation or disconnect", async () => {
  vi.useFakeTimers();
  let finishLookup!: (active: boolean) => void;
  const lookup = new Promise<boolean>((resolve) => { finishLookup = resolve; });
  const registry = createSessionSockets(() => lookup);
  const revoked = connection();
  const disconnected = connection();
  const pending = [
    registry.track(ticket("revoked", 1000), revoked),
    registry.track(ticket("other", 1000), disconnected),
  ];
  expect(registry.isActive(revoked)).toBe(false);
  registry.closeSessions(["revoked"]);
  registry.untrack(disconnected);
  finishLookup(true);
  expect(await Promise.all(pending)).toEqual([false, false]);
  expect(registry.isActive(revoked)).toBe(false);
  expect(registry.isActive(disconnected)).toBe(false);
  expect(revoked.close).toHaveBeenCalledExactlyOnceWith(1008, "Workspace session ended");
  expect(disconnected.close).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("closes the connection if the session lookup fails", async () => {
  vi.useFakeTimers();
  const registry = createSessionSockets(async () => { throw new Error("Database unavailable"); });
  const socket = connection();
  expect(await registry.track(ticket("session", 1000), socket)).toBe(false);
  expect(registry.isActive(socket)).toBe(false);
  expect(socket.close).toHaveBeenCalledExactlyOnceWith(1008, "Workspace session ended");
  expect(vi.getTimerCount()).toBe(0);
});
