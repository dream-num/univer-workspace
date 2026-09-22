import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { createConnectionNotice } from "../src/client/connection-notice.ts";
import { apply } from "../src/client/connection-recovery.ts";

vi.mock("../src/client/connection-notice.ts", () => ({ createConnectionNotice: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(initialState: "connected" | "connecting" | undefined = "connected") {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ ready: true, version: "a" }));
  const replace = vi.fn();
  const events = new EventTarget();
  let notify = () => {};
  let dispose = () => {};
  const unsubscribe = vi.fn();
  const show = vi.fn();
  const dismiss = vi.fn();
  let connectionState: string | undefined = initialState;
  let actions!: { refresh: () => void; retry: () => void };
  vi.mocked(createConnectionNotice).mockImplementation((_locale, handlers) => {
    actions = handlers;
    return { show, dispose: dismiss };
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("__UWH_CONNECTION_VERSION__", "a");
  vi.stubGlobal("window", { location: { replace }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
  const socket = globalThis.WebSocket;
  const ctx = {
    get: () => ({ state: { getSnapshot: () => connectionState, subscribe: (listener: () => void) => { notify = listener; return unsubscribe; } } }),
    effect: (effect: () => () => void) => { dispose = effect(); },
  } as unknown as Context;
  apply(ctx);
  expect(globalThis.fetch).toBe(fetch);
  expect(globalThis.WebSocket).toBe(socket);
  return { fetch, replace, notify: (state = "connected") => { connectionState = state; notify(); },
    dispose: () => dispose(), unsubscribe, events, noticeState: () => show.mock.lastCall?.[0],
    confirm: () => actions.refresh(), retry: () => actions.retry(), dismiss, show };
}

function pageShow(persisted: boolean) {
  return Object.assign(new Event("pageshow"), { persisted });
}

describe("global Workspace account recovery", () => {
  it("does not show a notice during healthy startup or the normal pageshow event", async () => {
    vi.useFakeTimers();
    const { notify, events, show, fetch, dispose } = setup("connecting");
    expect(show).not.toHaveBeenCalled();
    events.dispatchEvent(pageShow(false));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    notify("connected");
    await vi.advanceTimersByTimeAsync(0);
    expect(show.mock.calls.every(([state]) => state === undefined)).toBe(true);
    dispose();
  });

  it("detects an account switch during initial loading without a checking flash", async () => {
    vi.useFakeTimers();
    const { fetch, notify, show, noticeState, replace, dispose } = setup("connecting");
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockResolvedValue(Response.json({ ready: true, version: "b" }));
    notify("connected");
    await vi.advanceTimersByTimeAsync(0);
    expect(noticeState()).toBe("changed");
    expect(show).not.toHaveBeenCalledWith("checking");
    expect(replace).not.toHaveBeenCalled();
    dispose();
  });

  it("does not unlock a disconnected page just because HTTP is ready", async () => {
    vi.useFakeTimers();
    const { notify, noticeState, dispose } = setup();
    await vi.advanceTimersByTimeAsync(0);
    notify("disconnected");
    await vi.advanceTimersByTimeAsync(0);
    expect(noticeState()).toBe("checking");
    notify("connected");
    await vi.advanceTimersByTimeAsync(0);
    expect(noticeState()).toBeUndefined();
    dispose();
  });

  it("pauses immediately on connection loss and unlocks an unchanged account after checking", async () => {
    vi.useFakeTimers();
    const { fetch, replace, notify, noticeState, dispose } = setup();
    await vi.advanceTimersByTimeAsync(0);
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    notify("disconnected");
    expect(noticeState()).toBe("checking");
    notify("connected");
    finish(Response.json({ ready: true, version: "a" }));
    await vi.waitFor(() => expect(noticeState()).toBeUndefined());
    expect(replace).not.toHaveBeenCalled();
    dispose();
  });
  it("checks readiness again when the user confirms instead of refreshing a switching runtime", async () => {
    vi.useFakeTimers();
    const { fetch, replace, notify, noticeState, confirm, dispose } = setup();
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockImplementation(async () => Response.json({ ready: true, version: "b" }));
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(noticeState()).toBe("changed");
    fetch.mockResolvedValueOnce(Response.json({ ready: false, version: "b" }));
    confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(noticeState()).toBe("checking");
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    dispose();
  });
  it("allows an explicit retry after timeout without a new connection notification", async () => {
    vi.useFakeTimers();
    const { fetch, replace, notify, noticeState, retry, dispose } = setup();
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    notify("reconnecting");
    await vi.advanceTimersByTimeAsync(45_000);
    expect(noticeState()).toBe("unavailable");
    fetch.mockImplementation(async () => Response.json({ ready: true, version: "b" }));
    retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(noticeState()).toBe("changed");
    expect(replace).not.toHaveBeenCalled();
    dispose();
  });
  it("locks the old page after an account switch and reloads only after confirmation", async () => {
    const { fetch, replace, notify, dispose, noticeState, confirm } = setup();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fetch.mockImplementation(async () => Response.json({ ready: true, version: "b" }));
    notify();
    await vi.waitFor(() => expect(noticeState()).toBe("changed"));
    expect(replace).not.toHaveBeenCalled();
    confirm();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/"));
    notify();
    expect(replace).toHaveBeenCalledOnce();
    dispose();
  });
  it("waits for runtime readiness and does not poll healthy idle pages", async () => {
    vi.useFakeTimers();
    const { fetch, replace, notify, dispose, noticeState, confirm } = setup();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValueOnce(Response.json({ ready: false, version: "a" }))
      .mockImplementation(async () => Response.json({ ready: true, version: "b" }));
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(noticeState()).toBe("changed");
    expect(replace).not.toHaveBeenCalled();
    confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    dispose();
  });
  it.each(["network", "503"])("retries a %s failure after the last connection notification", async (failure) => {
    vi.useFakeTimers();
    const { fetch, replace, notify, dispose, noticeState, confirm } = setup();
    await vi.advanceTimersByTimeAsync(0);
    if (failure === "network") fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    else fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    fetch.mockImplementation(async () => Response.json({ ready: true, version: "b" }));
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(noticeState()).toBe("changed");
    expect(replace).not.toHaveBeenCalled();
    confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    const calls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(calls);
    dispose();
  });
  it("stops retries at the recovery deadline and can retry on a later notification", async () => {
    vi.useFakeTimers();
    const { fetch, replace, notify, dispose, noticeState, confirm } = setup();
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockImplementation(async () => new Response(null, { status: 503 }));
    notify();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetch.mock.calls.length).toBeGreaterThan(2);
    const calls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(replace).not.toHaveBeenCalled();
    expect(noticeState()).toBe("unavailable");
    fetch.mockImplementation(async () => Response.json({ ready: true, version: "b" }));
    notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(noticeState()).toBe("changed");
    confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    dispose();
  });
  it("stops a retry when disposed during its delay", async () => {
    vi.useFakeTimers();
    const { fetch, replace, notify, dispose, dismiss } = setup();
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    notify();
    await vi.advanceTimersByTimeAsync(0);
    dispose();
    expect(dismiss).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
  });
  it("does not retry permanent HTTP errors", async () => {
    vi.useFakeTimers();
    const { fetch, replace, notify, dispose } = setup();
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockResolvedValue(new Response(null, { status: 403 }));
    notify();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
    dispose();
  });
  it("keeps ordinary reconnections and reloads when browser authentication expires", async () => {
    const { fetch, replace, notify, dispose, noticeState, confirm } = setup();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    notify();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(replace).not.toHaveBeenCalled();
    fetch.mockResolvedValue(new Response(null, { status: 401 }));
    notify();
    await vi.waitFor(() => expect(noticeState()).toBe("expired"));
    expect(replace).not.toHaveBeenCalled();
    confirm();
    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    dispose();
  });
  it("checks restored pages and aborts pending checks on disposal", async () => {
    const { fetch, replace, events, dispose, unsubscribe } = setup();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    events.dispatchEvent(pageShow(true));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const signal = fetch.mock.calls[1]![1]!.signal!;
    dispose();
    expect(signal.aborted).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    finish(Response.json({ ready: true, version: "b" }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replace).not.toHaveBeenCalled();
    events.dispatchEvent(pageShow(true));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
