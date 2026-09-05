import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type { WorkspaceAuthService } from "./workspace-auth.ts";

const CLIENT_ID = "univer-workspace-harness";
const TTL = 10 * 60_000;
interface Pending { readonly state: string; readonly verifier: string; readonly origin: string; readonly redirectUri: string; readonly expiresAt: number }

export function createOAuthStartHandler(ctx: Context, pending: Map<string, Pending>, publicOrigin: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET") {
      res.writeHead(405, { "allow": "GET", "cache-control": "no-store" }); res.end(); return;
    }
    const origin = ctx.workspaceAuth.loginOrigin();
    for (const [key, value] of pending) if (value.expiresAt <= Date.now()) pending.delete(key);
    if (pending.size >= 32) { res.writeHead(429, { "cache-control": "no-store" }); res.end("Too many pending authorizations."); return; }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const redirectUri = new URL("/auth/oauth/callback", publicOrigin).href;
    pending.set(state, { state, verifier, origin, redirectUri, expiresAt: Date.now() + TTL });
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL("/api/auth/authorize", origin);
    url.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri, state, code_challenge: challenge, scope: "identity session" }).toString();
    res.writeHead(302, { location: url.href });
    res.end();
  };
}

export function createOAuthCallbackHandler(ctx: Context, pending: Map<string, Pending>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const state = url.searchParams.get("state") ?? "";
    const entry = pending.get(state);
    pending.delete(state);
    if (!entry || entry.expiresAt <= Date.now() || url.searchParams.get("error")) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }); res.end("Workspace authorization was denied or expired."); return;
    }
    const code = url.searchParams.get("code");
    if (!code) { res.writeHead(400, { "cache-control": "no-store" }); res.end("Workspace authorization was denied or expired."); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(new URL("/api/auth/token", entry.origin), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", client_id: CLIENT_ID, redirect_uri: entry.redirectUri, code, code_verifier: entry.verifier }), signal: controller.signal });
    } catch {
      res.writeHead(502, { "cache-control": "no-store" }); res.end("Workspace token exchange failed."); return;
    } finally { clearTimeout(timeout); }
    if (!response.ok) { res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); res.end("Workspace token exchange failed."); return; }
    const body = await response.json() as { access_token?: unknown; user?: { id?: unknown; username?: unknown; displayName?: unknown } };
    if (typeof body.access_token !== "string" || typeof body.user?.id !== "string" || typeof body.user.username !== "string") { res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); res.end("Workspace token response was invalid."); return; }
    await ctx.workspaceAuth.stageConnection({ userId: body.user.id, username: body.user.username, ...(typeof body.user.displayName === "string" ? { displayName: body.user.displayName } : {}) }, body.access_token, entry.origin);
    res.writeHead(303, { location: "/" });
    res.end();
  };
}
