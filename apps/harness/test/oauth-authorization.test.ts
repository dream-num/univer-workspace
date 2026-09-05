import { describe, expect, it, vi } from "vitest";
import { createOAuthCallbackHandler, createOAuthStartHandler } from "../src/oauth-authorization.js";

describe("Harness OAuth browser flow", () => {
  it("starts with state and PKCE, then exchanges the callback once", async () => {
    const pending = new Map<string, any>();
    const stageConnection = vi.fn(async () => undefined);
    const ctx = { workspaceAuth: { loginOrigin: () => "https://workspace.example", stageConnection } };
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
      await createOAuthCallbackHandler(ctx as never, pending)(new TestRequest(`GET /auth/oauth/callback?state=${state}&code=code-1`) as never, callbackResponse as never);
      expect(callbackResponse.status).toBe(303);
      expect(stageConnection).toHaveBeenCalledWith({ userId: "u1", username: "alice" }, "session", "https://workspace.example");
      expect(pending.has(state)).toBe(false);
      expect(entry.verifier).toBeTruthy();
    } finally { globalThis.fetch = originalFetch; }
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
