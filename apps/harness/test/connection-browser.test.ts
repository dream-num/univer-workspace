import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { connectionBrowserScript } from "../src/connection-browser.ts";

function browser() {
  const fetch = vi.fn(async (_input: Request | string, _init?: RequestInit) => Response.json({ ready: true, version: "selected" }));
  const replace = vi.fn();
  const sandbox = {
    __UWH_CONNECTION_VERSION__: "selected",
    fetch,
    WebSocket: class {
      listeners = new Map<string, () => void>();
      constructor(readonly url: string, readonly protocols?: string[]) {}
      addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    },
    location: { origin: "http://localhost:3101", href: "http://localhost:3101/", replace },
    Request, Headers, URL, AbortSignal, setTimeout,
    setInterval: vi.fn(),
    addEventListener: vi.fn(),
  };
  runInNewContext(connectionBrowserScript, sandbox);
  return { sandbox, fetch, replace };
}

describe("browser connection fence", () => {
  it("pins local requests without changing their body or remote credentials", async () => {
    const { sandbox, fetch } = browser();
    await sandbox.fetch("/api/session/prompt", {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"hello"}',
    });
    const [request, init] = fetch.mock.calls[0] as unknown as [Request, RequestInit];
    const forwarded = new Request(request, init);
    expect(forwarded.headers.get("x-uwh-connection")).toBe("selected");
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe('{"message":"hello"}');
    await sandbox.fetch("https://workspace.example/api/spaces");
    const remote = fetch.mock.calls[1]![0] as unknown as Request;
    expect(remote.headers.has("x-uwh-connection")).toBe(false);
  });

  it("pins local sockets and reloads a stale tab only after the next runtime is ready", async () => {
    const { sandbox, fetch, replace } = browser();
    const local = new sandbox.WebSocket("ws://localhost:3101/api/connect", ["rpc"]);
    expect(new URL(local.url).searchParams.get("uwhConnection")).toBe("selected");
    expect(local.protocols).toEqual(["rpc"]);
    const remote = new sandbox.WebSocket("wss://workspace.example/api/connect");
    expect(new URL(remote.url).searchParams.has("uwhConnection")).toBe(false);
    expect(sandbox.setInterval).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(Response.json({ ready: true, version: "next" }));
    const mux = new sandbox.WebSocket("ws://localhost:3101/api/remote.mux");
    mux.listeners.get("close")!();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/"));
  });
});
