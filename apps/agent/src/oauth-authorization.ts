import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { sendDesktopCallbackPage } from "./desktop-oauth-page.ts";

const CLIENT_ID = "univer-workspace-harness";
const TTL = 10 * 60_000;
export interface PendingOAuth { readonly state: string; readonly verifier: string; readonly origin: string; readonly redirectUri: string; readonly expiresAt: number; readonly connectionVersion: string; readonly desktop?: boolean; completing?: boolean }

export function beginOAuth(ctx: Context, pending: Map<string, PendingOAuth>, publicOrigin: string, desktop = false) {
  for (const [key, value] of pending) {
    if (value.expiresAt <= Date.now() || (desktop && value.desktop)) pending.delete(key);
  }
  if (pending.size >= 32) throw new Error("too_many_pending_authorizations");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const origin = ctx.workspaceAuth.loginOrigin();
  const redirectUri = new URL("/auth/oauth/callback", publicOrigin).href;
  const expiresAt = Date.now() + TTL;
  pending.set(state, { state, verifier, origin, redirectUri, expiresAt, connectionVersion: ctx.workspaceAuth.connectionVersion(), desktop });
  const url = new URL("/api/auth/authorize", origin);
  url.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri, state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), scope: "identity session" }).toString();
  return { authorizationUrl: url.href, state, expiresAt };
}

export async function exchangeOAuth(ctx: Context, entry: PendingOAuth, code: string, stillCurrent: () => boolean = () => true) {
  const version = entry.connectionVersion;
  if (entry.origin !== ctx.workspaceAuth.loginOrigin() || version !== ctx.workspaceAuth.connectionVersion()) throw new Error("workspace_authorization_origin_changed");
  const response = await fetch(new URL("/api/auth/token", entry.origin), {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: CLIENT_ID,
      redirect_uri: entry.redirectUri, code, code_verifier: entry.verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("workspace_token_exchange_failed");
  const body = await response.json() as { access_token?: unknown; user?: { id?: unknown; username?: unknown; displayName?: unknown } };
  if (typeof body.access_token !== "string" || typeof body.user?.id !== "string" || typeof body.user.username !== "string")
    throw new Error("workspace_token_response_invalid");
  // Settings can change while the remote exchange is in flight.
  if (entry.origin !== ctx.workspaceAuth.loginOrigin() || version !== ctx.workspaceAuth.connectionVersion() || !stillCurrent())
    throw new Error("workspace_authorization_origin_changed");
  await ctx.workspaceAuth.connect({ userId: body.user.id, username: body.user.username,
    ...(typeof body.user.displayName === "string" ? { displayName: body.user.displayName } : {}) }, body.access_token, entry.origin);
  return { userId: body.user.id, origin: entry.origin, version: ctx.workspaceAuth.connectionVersion() };
}

export function createOAuthStartHandler(ctx: Context, pending: Map<string, PendingOAuth>, publicOrigin: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET") {
      res.writeHead(405, { "allow": "GET", "cache-control": "no-store" }); res.end(); return;
    }
    let authorization;
    try { authorization = beginOAuth(ctx, pending, publicOrigin); }
    catch { res.writeHead(429, { "cache-control": "no-store" }); res.end("Too many pending authorizations."); return; }
    res.writeHead(302, { location: authorization.authorizationUrl, "cache-control": "no-store" });
    res.end();
  };
}

export function createOAuthCallbackHandler(ctx: Context, pending: Map<string, PendingOAuth>) {
  const completed = new Map<string, { expiresAt: number; userId: string; origin: string; version: string }>();
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
      // A completed authorization cannot switch the instance back after another login.
      if (receipt.version !== ctx.workspaceAuth.connectionVersion()) {
        sendCallbackPage(res, false);
        return;
      }
      sendCallbackPage(res, receipt);
      return;
    }
    const entry = pending.get(state);
    if (!entry && process.env.UWA_DESKTOP === "1") {
      sendDesktopCallbackPage(res, undefined, req.headers?.["accept-language"]?.startsWith("zh") === true);
      return;
    }
    if (entry?.desktop) {
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const valid = entry.expiresAt > Date.now() && entry.origin === ctx.workspaceAuth.loginOrigin() &&
        entry.connectionVersion === ctx.workspaceAuth.connectionVersion();
      if (!valid || error || !code || code.length > 2048) pending.delete(state);
      // The external browser has no DSH cookie. Return an authorization code;
      // only the authenticated Desktop client may exchange it using local PKCE.
      sendDesktopCallbackPage(res, valid ? { state, ...(error ? { error: "access_denied" } : code && code.length <= 2048 ? { code } : { error: "invalid_callback" }) } : undefined,
        req.headers?.["accept-language"]?.startsWith("zh") === true);
      return;
    }
    if (!entry || entry.expiresAt <= Date.now() || url.searchParams.get("error")) {
      pending.delete(state);
      sendCallbackPage(res, false, url.searchParams.get("error") === "access_denied");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) { sendCallbackPage(res, false); return; }
    pending.delete(state);
    let connected;
    try {
      connected = await exchangeOAuth(ctx, entry, code);
    } catch {
      res.writeHead(502, { "cache-control": "no-store" }); res.end("Workspace token exchange failed."); return;
    }
    if (completed.size >= 32) completed.delete(completed.keys().next().value!);
    const connection = { expiresAt: Date.now() + TTL, ...connected };
    completed.set(state, connection);
    sendCallbackPage(res, connection);
  };
}

function sendCallbackPage(res: ServerResponse, connection: false | { userId: string; origin: string; version: string }, denied = false): void {
  const success = connection !== false;
  const nonce = randomBytes(18).toString("base64url");
  const expected = JSON.stringify(connection).replaceAll("<", "\\u003c");
  const script = success ? `<script nonce="${nonce}">
const expected = ${expected};
const retry = document.getElementById("retry");
retry.addEventListener("click", () => { void waitForApplication(); });
async function waitForApplication() {
  retry.disabled = true;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("/api/uwh/me", { cache: "no-store", headers: { accept: "application/json", "x-uwh-connection": expected.version }, signal: AbortSignal.timeout(3000) });
      const status = response.ok ? await response.json() : null;
      if (status?.connected === true && status.switching === false && status.identity?.userId === expected.userId && status.workspaceOrigin === expected.origin) {
        const home = await fetch("/", { cache: "no-store", signal: AbortSignal.timeout(3000) });
        if (home.ok && home.headers.get("content-type")?.includes("text/html")) {
          window.location.replace("/");
          return;
        }
      }
    } catch {
      // Account-owned routes can be unavailable while switching identity.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  retry.disabled = false;
  document.getElementById("status").textContent = "Workspace is connected, but the application is not ready yet. Check again to continue safely.";
}
void waitForApplication();
</script>` : "";
  // Commit a local document before navigating to DSH. Its Strict cookie is
  // excluded from a cross-site OAuth redirect chain, even when the final URL is local.
  const title = success ? "Workspace connected" : denied ? "Connection cancelled" : "Start a new connection";
  const description = success
    ? "Your authorization is complete. Updating your Workspace…"
    : denied ? "You declined access. You can start again whenever you are ready."
      : "This connection request is no longer available. Start again to create a new request.";
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;margin:0;background:#f6f7fb;color:#171717;display:grid;min-height:100vh;place-items:center}main{max-width:420px;padding:32px;margin:20px;background:white;border:1px solid #e2e4ea;border-radius:16px}p{line-height:1.6}a{color:#5147bd}</style></head><body><main><h1>${title}</h1><p id="status">${description}</p>${success ? '<button id="retry" type="button" disabled>Check again</button><noscript>Enable JavaScript to finish connecting.</noscript>' : '<a href="/auth/oauth/start">Start again</a>'}</main>${script}</body></html>`);
}
