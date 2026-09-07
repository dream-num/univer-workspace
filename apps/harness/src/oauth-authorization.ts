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
  const completed = new Map<string, { expiresAt: number; userId: string; origin: string }>();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET", "cache-control": "no-store" });
      res.end();
      return;
    }
    for (const [key, receipt] of completed) {
      if (receipt.expiresAt <= Date.now()) completed.delete(key);
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const state = url.searchParams.get("state") ?? "";
    const receipt = completed.get(state);
    if (receipt !== undefined) {
      sendCallbackPage(res, receipt);
      return;
    }
    const entry = pending.get(state);
    if (!entry || entry.expiresAt <= Date.now() || url.searchParams.get("error")) {
      pending.delete(state);
      sendCallbackPage(res, false, url.searchParams.get("error") === "access_denied");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) { sendCallbackPage(res, false); return; }
    pending.delete(state);
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
    if (completed.size >= 32) completed.delete(completed.keys().next().value!);
    const connection = { expiresAt: Date.now() + TTL, userId: body.user.id, origin: entry.origin };
    completed.set(state, connection);
    sendCallbackPage(res, connection);
  };
}

function sendCallbackPage(res: ServerResponse, connection: false | { userId: string; origin: string }, denied = false): void {
  const success = connection !== false;
  const nonce = randomBytes(18).toString("base64url");
  const expected = JSON.stringify(connection).replaceAll("<", "\\u003c");
  const script = success ? `<script nonce="${nonce}">
const expected = ${expected};
const deadline = Date.now() + 45000;
async function waitForApplication() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch("/api/uwh/me", { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) });
      const status = response.ok ? await response.json() : null;
      if (status?.connected === true && status.restartRequired === false && status.identity?.userId === expected.userId && status.workspaceOrigin === expected.origin) {
        const home = await fetch("/", { cache: "no-store", signal: AbortSignal.timeout(3000) });
        if (home.ok && home.headers.get("content-type")?.includes("text/html")) {
          window.location.replace("/");
          return;
        }
      }
    } catch {
      // The supervised child can be unavailable while switching identity.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  document.getElementById("status").textContent = "Workspace is connected, but the application is still starting. Try the link below in a moment.";
}
void waitForApplication();
</script>` : "";
  // Commit a local document before navigating to DSH. Its Strict cookie is
  // excluded from a cross-site OAuth redirect chain, even when the final URL is local.
  const title = success ? "Workspace connected" : denied ? "Connection cancelled" : "Start a new connection";
  const description = success
    ? "Your authorization is complete. Waiting for the application to start…"
    : denied ? "You declined access. You can start again whenever you are ready."
      : "This connection request is no longer available. Start again to create a new request.";
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;margin:0;background:#f6f7fb;color:#171717;display:grid;min-height:100vh;place-items:center}main{max-width:420px;padding:32px;margin:20px;background:white;border:1px solid #e2e4ea;border-radius:16px}p{line-height:1.6}a{color:#5147bd}</style></head><body><main><h1>${title}</h1><p id="status">${description}</p><a href="${success ? "/" : "/auth/oauth/start"}">${success ? "Continue to application" : "Start again"}</a></main>${script}</body></html>`);
}
