/**
 * @univerjs/univer-workspace-harness — host half.
 *
 * Registers the Workspace OAuth login/callback and mounts the `workspaceAuth`
 * and `workspaceSession` services consumed by capability plugins. Workspace
 * product routes and Viewer behavior are owned by those plugins.
 *
 *  - `GET /auth/login` — starts the OAuth flow (state + PKCE, in-memory
 *    attempt, HttpOnly state cookie) and redirects to the Workspace authorize
 *    endpoint.
 *  - `GET /auth/callback` — validates state, exchanges the code for the user
 *    identity and a Workspace session token (`session` scope), stores the
 *    token server-side, signs the harness session cookie, and redirects back.
 *
 * @module @univerjs/univer-workspace-harness
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type {} from "@deepseek-ai/dsh-host-webserver";
import {
  UWH_CALLBACK_PATH, UWH_LOGIN_PATH,
} from "./contract.ts";
import {
  callbackUrlFor, exchangeCode, parseCookies, pkceChallenge,
  randomPkceVerifier, randomState, signSessionCookie, workspaceAuthorizeUrl,
  workspaceTokenUrl,
  type LoginAttempt,
} from "./auth.ts";
import * as workspaceAuthProvider from "./workspace-auth-provider.ts";
import * as workspaceSessionProvider from "./workspace-session-provider.ts";
import * as sessionInputGuard from "./session-input-guard.ts";
import { registerScopedListRoutes } from "./scoped-api.ts";
import { installScopedConnection, waitForStockConnectionRoutes } from "./scoped-connection.ts";
import { responseErrorBody } from "./diagnostics.ts";

export {
  buildAuthorizeUrl, callbackUrlFor, exchangeCode, extractIdentity, parseCookies, parseSessionCookie, randomPkceVerifier, randomState, signSessionCookie, workspaceAuthorizeUrl,
} from "./auth.ts";
export {
  isDirectSha256Child,
  workspacePathFor, workspacePathName, spaceDirectoryName, spaceDirectoryPath, isUserScopedPath,
  SHA_256_HEX_LENGTH,
} from "./identity.ts";
export { WorkspaceAuthService, WORKSPACE_SESSION_COOKIE, type WorkspaceHttpClient } from "./workspace-auth.ts";
export { WorkspaceSessionService } from "./workspace-session.ts";

/** Host plugin configuration (validated; all secrets from config). */
export interface Config {
  /** The configured emptyDir mount root for per-user directories. */
  workspaceRoot: string;
  /** The default Workspace origin (overridable through settings). */
  workspaceOrigin: string;
  /** The deployment origin the harness is served on (used to build the callback URL). */
  publicOrigin: string;
  /** The OAuth client id registered in the Workspace authorization server. */
  oauthClientId: string;
  /** The confidential OAuth client secret (server-side only). */
  oauthClientSecret: string;
  /** The secret used to sign the short-lived HttpOnly harness session cookie. */
  sessionSecret: string;
  /** Requested OAuth scope against the identity server (needs `session` for a credential). */
  authorizeScope: string;
  /** Login route path (starts the OAuth flow). */
  loginPath: string;
  /** Callback route path (receives the authorization code). */
  callbackPath: string;
  /** Name of the short-lived HttpOnly harness session cookie. */
  sessionCookieName: string;
  /** Session cookie lifetime in milliseconds. */
  sessionTtlMs: number;
  /** Login-state cookie lifetime in milliseconds. */
  stateTtlMs: number;
  /** Whether the session cookie carries the Secure attribute (HTTPS). */
  secureCookies: boolean;
  /** Whether local/dev users may use DSH's profile-global Models settings. */
  modelSettingsEnabled: boolean;
}

export const Config: z<Config> = z.object({
  workspaceRoot: z.string().required(),
  workspaceOrigin: z.string().required(),
  publicOrigin: z.string().required(),
  oauthClientId: z.string().required(),
  oauthClientSecret: z.string().required(),
  sessionSecret: z.string().required(),
  authorizeScope: z.string().default("identity session"),
  loginPath: z.string().default(UWH_LOGIN_PATH),
  callbackPath: z.string().default(UWH_CALLBACK_PATH),
  sessionCookieName: z.string().default("dsh_session"),
  sessionTtlMs: z.natural().max(3_600_000).default(900_000),
  stateTtlMs: z.natural().max(600_000).default(120_000),
  secureCookies: z.boolean().default(true),
  modelSettingsEnabled: z.boolean().default(false),
});

/** Stable Cordis plugin name. */
export const name = "univer-workspace-harness";

/** Required services. */
export const inject = ["webServer", "apiProxy", "workspaceRegistry", "sessions", "sessionPersistence", "storageDomain"];

/** Validate deployment origins before any route/service is registered. */
function assertHttpOrigin(value: string, field: "publicOrigin" | "workspaceOrigin"): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`univer-workspace-harness: ${field} must be an absolute http(s) URL; received ${JSON.stringify(value)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`univer-workspace-harness: ${field} must use http or https; received ${JSON.stringify(value)}`);
  }
}

/** Write a JSON response with the given status. */
function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(responseErrorBody(status, body)));
}

/** Redirect the browser to a URL. */
function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

/** Append one cookie value to the response's Set-Cookie header. */
export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; httpOnly: boolean; secure: boolean },
): void {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${opts.maxAgeSeconds}`,
    "SameSite=Lax",
  ];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  const previous = res.getHeader("Set-Cookie");
  const cookies = previous === undefined
    ? []
    : Array.isArray(previous) ? previous.map(String) : [String(previous)];
  res.setHeader("Set-Cookie", [...cookies, parts.join("; ")]);
}

/** Clear a cookie by setting an empty value with a zero max-age. */
function clearCookie(res: ServerResponse, name: string, secure: boolean): void {
  setCookie(res, name, "", { maxAgeSeconds: 0, httpOnly: true, secure });
}

/** Read the named cookie from the request. */
function readCookie(req: IncomingMessage, name: string): string | undefined {
  return parseCookies(req.headers.cookie).get(name);
}

/** Build the login route handler. */
export function createLoginHandler(config: Config, loginAttempts: Map<string, LoginAttempt>, callbackUrl: string): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    // The state cookie is host-only by design.  If a user enters the service
    // through an alias (for example `localhost`) while the registered OAuth
    // callback uses the canonical public origin (`127.0.0.1`), the browser
    // would store the cookie on the alias and never send it to the callback
    // host.  Canonicalize before creating an attempt so every successful flow
    // has one origin and one cookie scope.
    const requestHost = req.headers.host;
    if (typeof requestHost === "string" && requestHost.trim() !== "") {
      const publicHost = new URL(config.publicOrigin).host;
      if (normalizeHost(requestHost) !== normalizeHost(publicHost)) {
        return redirect(res, new URL(config.loginPath, config.publicOrigin).toString());
      }
    }
    const now = Date.now();
    for (const [attemptState, attempt] of loginAttempts) {
      if (attempt.expiresAt <= now) loginAttempts.delete(attemptState);
    }
    const state = randomState();
    const verifier = randomPkceVerifier();
    const returnTo = new URL(req.url ?? "/", "http://x").pathname;
    loginAttempts.set(state, {
      verifier,
      returnTo: sanitizeReturnTo(returnTo),
      expiresAt: now + config.stateTtlMs,
    });
    setCookie(res, config.sessionCookieName + "_state", state, {
      maxAgeSeconds: Math.floor(config.stateTtlMs / 1000),
      httpOnly: true,
      secure: config.secureCookies,
    });
    const location = workspaceAuthorizeUrl(config.workspaceOrigin, {
      clientId: config.oauthClientId,
      redirectUri: callbackUrl,
      scope: config.authorizeScope,
      state,
      codeChallenge: pkceChallenge(verifier),
    });
    redirect(res, location);
  };
}

/** Normalize a Host header and URL host for a stable alias comparison. */
function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, "");
}

/** Return a non-looping, safe diagnostic for an OAuth callback failure. */
function oauthCallbackFailure(
  res: ServerResponse,
  status: number,
  code: "oauth_state_invalid" | "oauth_token_exchange_failed",
  diagnostic: string,
): void {
  // Diagnostics stay on the server.  The browser receives only a stable
  // machine-readable code; stack traces, filesystem paths, and upstream
  // OAuth details must never cross this boundary.
  console.warn(`univer-workspace-harness: ${code}: ${diagnostic}`);
  jsonResponse(res, status, { error: code });
}

/** Build the callback route handler. */
export function createCallbackHandler(ctx: Context, config: Config, loginAttempts: Map<string, LoginAttempt>, callbackUrl: string): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    const url = new URL(req.url ?? "/callback", "http://x");
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    const attempt = state === "" ? undefined : loginAttempts.get(state);
    const stateCookie = readCookie(req, config.sessionCookieName + "_state");

    const stateValid = attempt !== undefined && attempt.expiresAt > Date.now();
    const stateCookieMatches = stateCookie !== undefined && stateCookie === state;
    if (!stateValid || code === null || !stateCookieMatches) {
      if (attempt !== undefined) loginAttempts.delete(state);
      const detail = `stateValid=${String(stateValid)} codePresent=${String(code !== null)} stateCookiePresent=${String(stateCookie !== undefined)} stateCookieMatches=${String(stateCookieMatches)}`;
      return oauthCallbackFailure(res, 400, "oauth_state_invalid", detail);
    }
    loginAttempts.delete(state);
    try {
      const result = await exchangeCode(workspaceTokenUrl(config.workspaceOrigin), {
        clientId: config.oauthClientId,
        clientSecret: config.oauthClientSecret,
        redirectUri: callbackUrl,
        code,
        verifier: attempt.verifier,
      });
      if (result.accessToken !== "") {
        const expiresAtMs = Date.now() + result.expiresIn * 1000;
        const workspaceAuth = ctx.get("workspaceAuth") as
          | { storeCredential(userId: string, token: string, expiresAtMs: number): Promise<void> }
          | undefined;
        if (workspaceAuth === undefined) {
          throw new Error("workspaceAuth service is unavailable");
        }
        await workspaceAuth.storeCredential(result.identity.userId, result.accessToken, expiresAtMs);
      }
      const cookie = signSessionCookie(result.identity, config.sessionSecret, config.sessionTtlMs);
      setCookie(res, config.sessionCookieName, cookie, {
        maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
        httpOnly: true,
        secure: config.secureCookies,
      });
      clearCookie(res, config.sessionCookieName + "_state", config.secureCookies);
      return redirect(res, attempt.returnTo);
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : "unknown token exchange failure";
      return oauthCallbackFailure(res, 502, "oauth_token_exchange_failed", detail);
    }
  };
}

/** Restrict a return-to path to an in-site path (never an open redirect). */
function sanitizeReturnTo(pathname: string): string {
  if (pathname === "" || pathname === "/" || pathname === "/auth/login") return "/";
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) return "/";
  return pathname;
}

/** Register only authentication, public services, and generic DSH isolation. */
export function apply(ctx: Context, config: Config): void {
  assertHttpOrigin(config.publicOrigin, "publicOrigin");
  assertHttpOrigin(config.workspaceOrigin, "workspaceOrigin");

  // workspaceAuth and workspaceSession must be visible to SIBLING rows (the
  // capability plugin), so their services are constructed directly against
  // the SHARED ROOT store — synchronous on purpose: the Service base
  // constructor publishes each provider during construction, so composition
  // activation completes deterministically instead of pending a sibling row.
  // The credentials domain opens asynchronously behind `workspaceAuth.ready`.
  const workspaceAuth = new workspaceAuthProvider.WorkspaceAuthProvider(ctx.root, {
    workspaceOrigin: config.workspaceOrigin,
  });
  void workspaceAuth.ready.catch((error: unknown) => {
    console.error("[uwh] credentials domain failed to open", error);
  });
  new workspaceSessionProvider.WorkspaceSessionProvider(ctx.root, {
    sessionCookieName: config.sessionCookieName,
    sessionSecret: config.sessionSecret,
  });
  // Replace DSH's single-user browser carrier with the same transport plus an
  // account scope. The browser half remains statically mounted by this
  // harness bundle; only the host transport carrier is replaced here.
  ctx.effect(
    async () => {
      await waitForStockConnectionRoutes(ctx.root);
      return installScopedConnection(ctx.root, {
        workspaceRoot: config.workspaceRoot,
        workspaceOrigin: config.workspaceOrigin,
        publicOrigin: config.publicOrigin,
        sessionCookieName: config.sessionCookieName,
        sessionSecret: config.sessionSecret,
        modelSettingsEnabled: config.modelSettingsEnabled,
      });
    },
    "uwh: authenticated DSH connection carrier",
  );
  ctx.plugin(sessionInputGuard, {
    workspaceRoot: config.workspaceRoot,
    sessionCookieName: config.sessionCookieName,
    sessionSecret: config.sessionSecret,
    publicOrigin: config.publicOrigin,
  });
  const loginAttempts = new Map<string, LoginAttempt>();
  const callbackUrl = callbackUrlFor(config.publicOrigin, config.callbackPath);
  ctx.effect(() => {
    const routes = [
      ctx.webServer.register({ kind: "exact", path: config.loginPath, handler: createLoginHandler(config, loginAttempts, callbackUrl) }),
      ctx.webServer.register({ kind: "exact", path: config.callbackPath, handler: createCallbackHandler(ctx, config, loginAttempts, callbackUrl) }),
      ...registerScopedListRoutes(ctx, {
        workspaceRoot: config.workspaceRoot,
        workspaceOrigin: config.workspaceOrigin,
        publicOrigin: config.publicOrigin,
        sessionCookieName: config.sessionCookieName,
        sessionSecret: config.sessionSecret,
        modelSettingsEnabled: config.modelSettingsEnabled,
      }),
    ];
    return () => {
      for (const dispose of routes) dispose();
      loginAttempts.clear();
    };
  }, "uwh: oauth login/callback + generic DSH scope routes");
}
