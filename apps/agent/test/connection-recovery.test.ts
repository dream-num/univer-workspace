import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { apply } from "../src/client/connection-recovery.ts";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ ready: true, version: "a" }));
  const replace = vi.fn();
  const events = new EventTarget();
  let notify = () => {};
  let dispose = () => {};
  const unsubscribe = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("__UWH_CONNECTION_VERSION__", "a");
  vi.stubGlobal("window", { location: { replace }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
  const socket = globalThis.WebSocket;
  const ctx = {
    get: () => ({ state: { subscribe: (listener: () => void) => { notify = listener; return unsubscribe; } } }),
    effect: (effect: () => () => void) => { dispose = effect(); },
  } as unknown as Context;
  apply(ctx);
  expect(globalThis.fetch).toBe(fetch);
  expect(globalThis.WebSocket).toBe(socket);
  return { fetch, replace, notify: () => notify(), dispose: () => dispose(), unsubscribe, events };
}

describe("global Workspace account recovery", () => {
  it("reloads after an account switch through connection notifications", async () => {
    const { fetch, replace, notify, dispose } = setup();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fetch.mockResolvedValue(Response.json({ ready: true, version: "b" }));
    notify();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/"));
    notify();
    expect(replace).toHaveBeenCalledOnce();
    dispose();
  });
  it("waits for runtime readiness and does not poll healthy idle pages", async () => {
    vi.useFakeTimers();
    const { fetch, replace, notify, dispose } = setup();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValueOnce(Response.json({ ready: false, version: "a" }))
      .mockResolvedValue(Response.json({ ready: true, version: "b" }));
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    dispose();
  });
  it("keeps ordinary reconnections and reloads when browser authentication expires", async () => {
    const { fetch, replace, notify, dispose } = setup();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    notify();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(replace).not.toHaveBeenCalled();
    fetch.mockResolvedValue(new Response(null, { status: 401 }));
    notify();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/"));
    dispose();
  });
  it("checks restored pages and aborts pending checks on disposal", async () => {
    const { fetch, replace, events, dispose, unsubscribe } = setup();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    events.dispatchEvent(new Event("pageshow"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const signal = fetch.mock.calls[1]![1]!.signal!;
    dispose();
    expect(signal.aborted).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    finish(Response.json({ ready: true, version: "b" }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replace).not.toHaveBeenCalled();
    events.dispatchEvent(new Event("pageshow"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
