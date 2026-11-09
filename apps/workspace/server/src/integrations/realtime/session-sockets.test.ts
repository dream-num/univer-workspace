import { afterEach, expect, it, vi } from "vitest";
import { createSessionSockets } from "./session-sockets.js";

const connection = () => ({ id: "socket", customData: {}, send: vi.fn(), close: vi.fn() });

afterEach(() => vi.useRealTimers());

it("releases timers on untrack and closes only the selected session", () => {
  vi.useFakeTimers();
  const registry = createSessionSockets(() => true);
  const removed = connection();
  const revoked = connection();
  const other = connection();
  const untrack = registry.track("session", Date.now() + 1000, removed);
  registry.track("session", Date.now() + 1000, revoked);
  registry.track("other", Date.now() + 2000, other);
  untrack();
  untrack();
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

it("supports session lifetimes above Node's maximum timer delay without closing early", () => {
  vi.useFakeTimers();
  const registry = createSessionSockets(() => true);
  const socket = connection();
  const lifetime = 30 * 24 * 60 * 60 * 1000;
  registry.track("session", Date.now() + lifetime, socket);
  vi.advanceTimersByTime(lifetime - 1);
  expect(socket.close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(socket.close).toHaveBeenCalledExactlyOnceWith(1008, "Workspace session ended");
  expect(vi.getTimerCount()).toBe(0);
});
