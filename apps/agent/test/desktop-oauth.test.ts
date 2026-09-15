import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localRouteDefinitions } from "../src/index.ts";
import { createDesktopOAuthHandlers } from "../src/desktop-oauth.ts";
import { createOAuthCallbackHandler, type PendingOAuth } from "../src/oauth-authorization.ts";
const origin = "http://127.0.0.1:3101";
class Reply {
  status = 200; headers: Record<string, string> = {}; body = "";
  writeHead(status: number, headers = {}) { this.status = status; this.headers = headers; }
  end(body = "") { this.body = body; }
  json() { return JSON.parse(this.body); }
}
function request(body = {}, headers: object = { origin, cookie: "local-session" }) {
  return Object.assign(Readable.from([JSON.stringify(body)]), { method: "POST", headers });
}
function setup() {
  let loginOrigin = "https://workspace.example", version = "v1";
  const connect = vi.fn(async () => { version = "v2"; });
  const ctx = { connection: { requestRejection: (req: any) => req.headers.cookie ? undefined : 401 },
    workspaceAuth: { loginOrigin: () => loginOrigin, connectionVersion: () => version, switching: () => false, disconnect: vi.fn(async () => { version = "v2"; }), connect } };
  const pending = new Map<string, PendingOAuth>();
  const handlers = createDesktopOAuthHandlers(ctx as never, pending, origin);
  const start = async () => { const res = new Reply(); await handlers.start(request() as never, res as never); return res.json(); };
  const complete = async (state: string) => { const res = new Reply(); await handlers.complete(request({ state, code: "one-use-code" }) as never, res as never); return res; };
  return { pending, handlers, start, complete, connect, ctx, changeOrigin: () => { loginOrigin = "https://other.example"; } };
}
afterEach(() => vi.unstubAllGlobals());
describe("Desktop browser OAuth", () => {
  it("returns a code through the scheme, then exchanges PKCE only from the authenticated app once", async () => {
    const s = setup();
    const started = await s.start();
    const entry = s.pending.get(started.state)!;
    expect(new URL(started.authorizationUrl).searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    const callback = new Reply();
    await createOAuthCallbackHandler(s.ctx as never, s.pending)({ method: "GET", headers: {},
      url: `/auth/oauth/callback?state=${started.state}&code=one-use-code` } as never, callback as never);
    expect(callback.body).toContain(`univer-workspace://login#state=${started.state}`);
    expect(callback.body).not.toContain(entry.verifier);
    expect(callback.headers["referrer-policy"]).toBe("no-referrer");
    expect(callback.body).toContain("history.replaceState");
    expect(s.connect).not.toHaveBeenCalled();
    const fetch = vi.fn(async () => Response.json({ access_token: "secret-token", user: { id: "u1", username: "alice" } }));
    vi.stubGlobal("fetch", fetch);
    expect((await s.complete(started.state)).json()).toEqual({ connected: true, version: "v2" });
    expect(JSON.parse((fetch.mock.calls as any)[0][1].body).code_verifier).toBe(entry.verifier);
    expect(s.connect).toHaveBeenCalledWith({ userId: "u1", username: "alice" }, "secret-token", "https://workspace.example");
    expect((await s.complete(started.state)).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unauthenticated, cross-origin, expired, superseded and changed-origin requests", async () => {
    const s = setup();
    for (const headers of [{ origin }, { origin: "https://evil.example", cookie: "local-session" }]) {
      const reply = new Reply(); await s.handlers.start(request({}, headers) as never, reply as never);
      expect([401, 403]).toContain(reply.status);
    }
    const first = await s.start(); const second = await s.start();
    expect((await s.complete(first.state)).status).toBe(400);
    s.pending.set(second.state, { ...s.pending.get(second.state)!, expiresAt: 0 });
    expect((await s.complete(second.state)).status).toBe(400);
    const third = await s.start(); s.changeOrigin();
    expect((await s.complete(third.state)).status).toBe(400);
    expect(s.connect).not.toHaveBeenCalled();
  });
  it("invalidates waiting desktop requests when the user disconnects", async () => {
    const s = setup(); const first = await s.start();
    const logout = localRouteDefinitions(s.ctx as never, new Map(), s.pending, origin)
      .find(route => route.path === "/auth/device/logout")!;
    const reply = new Reply();
    await logout.handler(request() as never, reply as never);
    expect(reply.status).toBe(200);
    expect(s.pending.size).toBe(0);
    expect((await s.complete(first.state)).status).toBe(400);
    expect(s.connect).not.toHaveBeenCalled();
  });
  it("rejects pending desktop login after a different connection is activated", async () => {
    const s = setup(); const first = await s.start();
    await s.ctx.workspaceAuth.disconnect();
    expect((await s.complete(first.state)).status).toBe(400);
    expect(s.connect).not.toHaveBeenCalled();
  });
  it("cannot complete an in-flight exchange while disconnect is draining the old runtime", async () => {
    const s = setup(); const first = await s.start();
    let finish!: (response: Response) => void;
    let disconnected!: () => void;
    s.ctx.workspaceAuth.disconnect.mockImplementation(() => new Promise<void>(resolve => { disconnected = resolve; }));
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const completing = s.complete(first.state);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const logout = localRouteDefinitions(s.ctx as never, new Map(), s.pending, origin)
      .find(route => route.path === "/auth/device/logout")!;
    const disconnecting = logout.handler(request() as never, new Reply() as never);
    finish(Response.json({ access_token: "old-token", user: { id: "old", username: "old" } }));
    expect((await completing).status).toBe(502);
    expect(s.connect).not.toHaveBeenCalled();
    disconnected(); await disconnecting;
  });
  it("cannot apply an in-flight old login after a new login starts", async () => {
    const s = setup(); const first = await s.start();
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const completing = s.complete(first.state);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect((await s.complete(first.state)).status).toBe(400);
    await s.start();
    finish(Response.json({ access_token: "old-token", user: { id: "old", username: "old" } }));
    expect((await completing).status).toBe(502);
    expect(s.connect).not.toHaveBeenCalled();
  });
});
