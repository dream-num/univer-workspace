import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { createOAuthCallbackHandler, createOAuthStartHandler } from "../src/oauth-authorization.js";

describe("Harness OAuth browser flow", () => {
  it("starts with state and PKCE, then exchanges the callback once", async () => {
    const pending = new Map<string, any>();
    const connect = vi.fn(async () => undefined);
    let version = "generation-1";
    const ctx = { workspaceAuth: { connectionVersion: () => version, loginOrigin: () => "https://workspace.example", connect } };
    const startResponse = new TestResponse();
    await createOAuthStartHandler(ctx as never, pending, "http://127.0.0.1:3101")(
      new TestRequest("GET") as never,
      startResponse as never,
    );
    expect(startResponse.status).toBe(302);
    const location = startResponse.headers.location;
    expect(location).toEqual(expect.any(String));
    if (location === undefined) return;
    const authorization = new URL(location);
    expect(authorization.pathname).toBe("/api/auth/authorize");
    expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const state = authorization.searchParams.get("state")!;
    const entry = pending.get(state);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "session", user: { id: "u1", username: "alice" } }), { status: 200 }));
    try {
      const callbackResponse = new TestResponse();
      const callback = createOAuthCallbackHandler(ctx as never, pending);
      await callback(new TestRequest(`GET /auth/oauth/callback?state=${state}&code=code-1`) as never, callbackResponse as never);
      expect(callbackResponse.status).toBe(200);
      expect(callbackResponse.body).not.toContain('href="/"');
      expect(callbackResponse.body).toContain('id="retry" type="button" disabled');
      expect(callbackResponse.body).not.toContain('http-equiv="refresh"');
      const script = callbackResponse.body.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/u)!;
      expect(callbackResponse.headers["content-security-policy"]).toContain(`script-src 'nonce-${script[1]}'`);
      const replace = vi.fn();
      const ready = { connected: true, switching: false, identity: { userId: "u1" }, workspaceOrigin: "https://workspace.example" };
      const browserFetch = vi.fn()
        .mockRejectedValueOnce(new Error("Restarting"))
        .mockResolvedValueOnce(Response.json({ ...ready, switching: true }))
        .mockResolvedValueOnce(Response.json({ ...ready, identity: { userId: "previous-user" } }))
        .mockResolvedValueOnce(Response.json({ ...ready, workspaceOrigin: "https://other.example" }))
        .mockResolvedValueOnce(Response.json(ready))
        .mockResolvedValueOnce(new Response("Not ready", { status: 404 }))
        .mockResolvedValueOnce(Response.json(ready))
        .mockResolvedValueOnce(new Response("<!doctype html>", { headers: { "content-type": "text/html" } }));
      await runInNewContext(script[2]!.replace(/void waitForApplication\(\);\s*$/, "waitForApplication();"), {
        document: { getElementById: () => ({ disabled: true, addEventListener: vi.fn() }) },
        fetch: browserFetch, AbortSignal, setTimeout: (resolve: () => void) => resolve(),
        window: { location: { replace } },
      });
      expect(browserFetch).toHaveBeenCalledTimes(8);
      expect(replace).toHaveBeenCalledExactlyOnceWith("/");
      expect(callbackResponse.headers.location).toBeUndefined();
      expect(connect).toHaveBeenCalledWith({ userId: "u1", username: "alice" }, "session", "https://workspace.example");
      expect(pending.has(state)).toBe(false);
      expect(entry.verifier).toBeTruthy();
      const replay = new TestResponse();
      await callback(new TestRequest(`GET /auth/oauth/callback?state=${state}&code=code-1`) as never, replay as never);
      expect(replay.body).toContain("Workspace connected");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledTimes(1);
      version = "generation-2";
      const superseded = new TestResponse();
      await callback(new TestRequest(`GET /auth/oauth/callback?state=${state}&code=code-1`) as never, superseded as never);
      expect(superseded.body).toContain('href="/auth/oauth/start"');
      expect(superseded.body).not.toContain("Workspace connected");
    } finally { globalThis.fetch = originalFetch; }
  });
  it("offers a new flow when the local request is gone", async () => {
    const response = new TestResponse();
    await createOAuthCallbackHandler({} as never, new Map())(
      new TestRequest("GET /auth/oauth/callback?state=expired&code=unused") as never,
      response as never,
    );
    expect(response.body).toContain('href="/auth/oauth/start"');
    expect(response.body).not.toContain("denied or expired");
  });
});

class TestRequest {
  method: string;
  url: string;
  constructor(value: string) { const [method, url = "/"] = value.split(" "); this.method = method!; this.url = url; }
}
class TestResponse {
  status = 200;
  headers: Record<string, string> = {};
  body = "";
  writeHead(status: number, headers: Record<string, string> = {}) { this.status = status; this.headers = { ...headers }; return this; }
  end(body?: string) { this.body = body ?? ""; }
}
