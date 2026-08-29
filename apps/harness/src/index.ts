/**
 * @univerjs/univer-workspace-harness — host half.
 *
 * Registers the Workspace OAuth login/callback, the identity bootstrap, and
 * the template-fork routes, and mounts the `workspaceAuth` service sibling
 * plugins consume. There is no gateway, no proxy, and no header-based
 * identity path: every Workspace call happens server-side with the user's own
 * session credential.
 *
 *  - `GET /auth/login` — starts the OAuth flow (state + PKCE, in-memory
 *    attempt, HttpOnly state cookie) and redirects to the Workspace authorize
 *    endpoint.
 *  - `GET /auth/callback` — validates state, exchanges the code for the user
 *    identity and a Workspace session token (`session` scope), stores the
 *    token server-side, signs the harness session cookie, and redirects back.
 *  - `GET /api/uwh/me` — identity / per-user workspace / admin / origin /
 *    templates bootstrap.
 *  - `POST /api/uwh/template-fork` — forks a configured template into a
 *    per-user child session.
 *
 * @module @univerjs/univer-workspace-harness
 */

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { SessionId, SessionEvent } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type { WorkspaceView } from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-workspace";
import {
  UWH_CALLBACK_PATH, UWH_LOGIN_PATH, UWH_ME_PATH, UWH_SPACES_PATH, UWH_TEMPLATE_FORK_PATH,
  type UwhIdentity, type UwhMeView, type UwhTemplate,
} from "./contract.ts";
import {
  callbackUrlFor, exchangeCode, parseCookies, parseSessionCookie, pkceChallenge,
  randomPkceVerifier, randomState, signSessionCookie, workspaceAuthorizeUrl,
  workspaceTokenUrl,
  type LoginAttempt,
} from "./auth.ts";
import {
  buildMeView, isBalancedLog, projectWorkspaceView, seedCutForSource, workspacePathFor,
  type WorkspaceFacts,
} from "./identity.ts";
import * as workspaceAuthProvider from "./workspace-auth-provider.ts";
import * as workspaceSessionProvider from "./workspace-session-provider.ts";
import type { WorkspaceAuthService } from "./workspace-auth.ts";
import * as sessionInputGuard from "./session-input-guard.ts";
import { registerScopedListRoutes, trustedRequest } from "./scoped-api.ts";
import { installScopedConnection, waitForStockConnectionRoutes } from "./scoped-connection.ts";
import { WORKSPACE_FAVICON_SVG, WORKSPACE_MANIFEST_JSON } from "./favicon.ts";
import { rewriteHarnessIndexBranding, rewriteHarnessIndexTitle } from "./title.ts";

export {
  buildAuthorizeUrl, callbackUrlFor, exchangeCode, extractIdentity, parseCookies, parseSessionCookie, randomPkceVerifier, randomState, signSessionCookie, workspaceAuthorizeUrl,
} from "./auth.ts";
export {
  buildMeView, isBalancedLog, isDirectSha256Child, projectWorkspaceView, seedCutForSource,
  workspacePathFor, workspacePathName, spaceDirectoryName, spaceDirectoryPath, isUserScopedPath,
  SHA_256_HEX_LENGTH,
} from "./identity.ts";
export { WorkspaceAuthService, WORKSPACE_SESSION_COOKIE, type WorkspaceHttpClient } from "./workspace-auth.ts";
export { WorkspaceSessionService } from "./workspace-session.ts";
export { rewriteHarnessIndexBranding, rewriteHarnessIndexTitle };

/** A workspace entity the idempotent handlers use. */
export interface WorkspaceLike extends WorkspaceFacts {
  /** Attach a session to this workspace (idempotent). */
  attachSession(sessionId: SessionId): Promise<void>;
}

/** The composed services the authenticated routes need. */
export interface AuthClient {
  resolveByPath(path: string): Promise<WorkspaceLike | undefined>;
  create(path: string, title?: string): Promise<WorkspaceLike>;
  createSession(id: SessionId, options: { seed: readonly SessionEvent[]; meta: Record<string, unknown> }): unknown;
  load(sourceId: SessionId): Promise<{ events: readonly SessionEvent[] }>;
}

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
  /** Workspace usernames that receive the `admin` flag (not a second role DB). */
  adminUsernames: string[];
  /** Login route path (starts the OAuth flow). */
  loginPath: string;
  /** Callback route path (receives the authorization code). */
  callbackPath: string;
  /** Identity/bootstrap route path. */
  mePath: string;
  /** Template-fork route path. */
  templateForkPath: string;
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
  /** Configured templates: stable key -> source session id + display metadata. */
  templates: UwhTemplate[];
}

/** Schemastery schema for {@link Config}. */
const templatesZ = z.array(z.object({
  key: z.string().required(),
  sessionId: z.string().required(),
  label: z.string().default(""),
  agentPreset: z.string().default(""),
  description: z.string().default(""),
}));

export const Config: z<Config> = z.object({
  workspaceRoot: z.string().required(),
  workspaceOrigin: z.string().required(),
  publicOrigin: z.string().required(),
  oauthClientId: z.string().required(),
  oauthClientSecret: z.string().required(),
  sessionSecret: z.string().required(),
  authorizeScope: z.string().default("identity session"),
  adminUsernames: z.array(String).default([]),
  loginPath: z.string().default(UWH_LOGIN_PATH),
  callbackPath: z.string().default(UWH_CALLBACK_PATH),
  mePath: z.string().default(UWH_ME_PATH),
  templateForkPath: z.string().default(UWH_TEMPLATE_FORK_PATH),
  sessionCookieName: z.string().default("dsh_session"),
  sessionTtlMs: z.natural().max(3_600_000).default(900_000),
  stateTtlMs: z.natural().max(600_000).default(120_000),
  secureCookies: z.boolean().default(true),
  modelSettingsEnabled: z.boolean().default(false),
  templates: templatesZ.default([]),
});

/** Stable Cordis plugin name. */
export const name = "univer-workspace-harness";

/** Required services. */
export const inject = ["webServer", "apiProxy", "workspaceRegistry", "sessions", "sessionPersistence", "storageDomain"];

/** Maximum size of one Harness JSON request. */
const JSON_REQUEST_MAX_BYTES = 8 * 1024;

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
  res.end(JSON.stringify(body));
}

/** Redirect the browser to a URL. */
function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

/** Serve one harness-owned static brand asset without touching DSH's fallback. */
function serveBrandAsset(
  req: IncomingMessage,
  res: ServerResponse,
  contentType: string,
  body: string,
): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
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

/** A resolved, authenticated context. */
type ResolvedContext =
  | { ok: true; identity: UwhIdentity; username: string; workspace: WorkspaceLike }
  | { ok: false; status: number; error: unknown };

/** Authenticate from the signed harness session cookie and resolve the user's workspace. */
async function resolveAuthenticatedContext(
  client: AuthClient,
  config: Config,
  req: IncomingMessage,
): Promise<ResolvedContext> {
  const identity = parseSessionCookie(readCookie(req, config.sessionCookieName), config.sessionSecret);
  if (identity === undefined) return { ok: false, status: 401, error: { error: "missing or invalid session" } };

  const derived = workspacePathFor(config.workspaceRoot, identity.userId);
  if (!derived.ok) return { ok: false, status: 400, error: { error: derived.reason } };

  let workspace: WorkspaceLike;
  try {
    await mkdir(derived.path, { recursive: true });
    workspace = (await client.resolveByPath(derived.path)) ?? await client.create(derived.path, identity.username);
  } catch {
    return { ok: false, status: 500, error: { error: "workspace could not be created or resolved" } };
  }
  return { ok: true, identity, username: identity.username, workspace };
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

/** Build the identity/workspace route handler. */
export function createIdentityHandler(
  client: AuthClient,
  config: Config,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!trustedRequest(req, config.publicOrigin)) {
      return jsonResponse(res, 403, { error: "forbidden" });
    }
    if (req.method !== "GET") return jsonResponse(res, 405, { error: "method not allowed" });
    const context = await resolveAuthenticatedContext(client, config, req);
    if (!context.ok) return jsonResponse(res, context.status, context.error);

    const body: UwhMeView = buildMeView(
      context.identity,
      projectWorkspaceView(context.workspace),
      config.adminUsernames.includes(context.username),
      config.workspaceOrigin,
      config.templates,
    );
    return jsonResponse(res, 200, body);
  };
}

/** Build the template-fork route handler. */
export function createTemplateForkHandler(
  client: AuthClient,
  config: Config,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!trustedRequest(req, config.publicOrigin)) {
      return jsonResponse(res, 403, { error: "forbidden" });
    }
    if (req.method !== "POST") return jsonResponse(res, 405, { error: "method not allowed" });
    const context = await resolveAuthenticatedContext(client, config, req);
    if (!context.ok) return jsonResponse(res, context.status, context.error);

    let payload: unknown;
    try {
      payload = await readJsonBody(req);
    } catch {
      return jsonResponse(res, 400, { error: "invalid request body" });
    }
    const key = (payload as { key?: unknown } | null)?.key;
    if (typeof key !== "string" || key.trim() === "") {
      return jsonResponse(res, 400, { error: "template key required" });
    }
    const template = config.templates.find(candidate => candidate.key === key);
    if (template === undefined) {
      return jsonResponse(res, 404, { error: `template ${JSON.stringify(key)} is not configured` });
    }

    const sourceId = template.sessionId as SessionId;
    let sourceEvents: readonly SessionEvent[];
    try {
      sourceEvents = (await client.load(sourceId)).events;
    } catch {
      return jsonResponse(res, 422, { error: "template source could not be loaded" });
    }
    const cut = seedCutForSource(sourceEvents);
    if (!cut.ok) return jsonResponse(res, 422, { error: cut.reason });

    const childId = `session-${randomUUID()}` as SessionId;
    try {
      client.createSession(childId, {
        seed: sourceEvents.slice(0, cut.cut),
        meta: {
          cwd: context.workspace.path,
          parentSession: sourceId,
          seedLength: cut.cut,
          ...(template.agentPreset === undefined || template.agentPreset === ""
            ? {}
            : { agentPreset: template.agentPreset }),
        },
      });
    } catch {
      return jsonResponse(res, 500, { error: "template fork failed" });
    }

    try {
      await context.workspace.attachSession(childId);
    } catch {
      return jsonResponse(res, 500, { error: "template fork could not attach to the workspace" });
    }
    return jsonResponse(res, 200, { sessionId: childId });
  };
}

interface WorkspaceApiSpaceView {
  readonly id: string;
  readonly name: string;
  readonly capabilities: {
    readonly renameSpace: boolean;
  };
}

/** Parse the narrow Space view needed at the Harness trust boundary. */
function workspaceApiSpaceView(value: unknown): WorkspaceApiSpaceView | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const capabilities = record.capabilities;
  if (typeof record.id !== "string" || typeof record.name !== "string") return undefined;
  if (capabilities === null || typeof capabilities !== "object") return undefined;
  const renameSpace = (capabilities as Record<string, unknown>).renameSpace;
  if (typeof renameSpace !== "boolean") return undefined;
  return { id: record.id, name: record.name, capabilities: { renameSpace } };
}

/** Extract exactly one encoded Space id below the Harness Space prefix. */
function requestSpaceId(req: IncomingMessage): string | undefined {
  const pathname = new URL(req.url ?? "/", "http://x").pathname;
  const prefix = `${UWH_SPACES_PATH}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const encoded = pathname.slice(prefix.length);
  if (encoded === "" || encoded.includes("/")) return undefined;
  try {
    const id = decodeURIComponent(encoded);
    if (id === "" || id.length > 200 || id.includes("/") || id.includes("\\")) return undefined;
    return id;
  } catch {
    return undefined;
  }
}

/** Build the cookie-authenticated, capability-checked Space rename proxy. */
export function createSpaceRenameHandler(
  workspaceAuth: WorkspaceAuthService,
  config: Pick<Config, "publicOrigin" | "sessionCookieName" | "sessionSecret">,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!trustedRequest(req, config.publicOrigin)) {
      return jsonResponse(res, 403, { error: "forbidden" });
    }
    if (req.method !== "PATCH") return jsonResponse(res, 405, { error: "method_not_allowed" });
    const spaceId = requestSpaceId(req);
    if (spaceId === undefined) return jsonResponse(res, 404, { error: "space_not_found" });

    const identity = parseSessionCookie(readCookie(req, config.sessionCookieName), config.sessionSecret);
    if (identity === undefined) return jsonResponse(res, 401, { error: "authentication_required" });
    const workspaceClient = workspaceAuth.clientFor(identity.userId);
    if (workspaceClient === undefined) {
      return jsonResponse(res, 401, { error: "workspace_authentication_required" });
    }

    let payload: unknown;
    try {
      payload = await readJsonBody(req);
    } catch {
      return jsonResponse(res, 400, { error: "space_name_invalid" });
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonResponse(res, 400, { error: "space_name_invalid" });
    }
    const fields = Object.keys(payload as Record<string, unknown>);
    const rawName = (payload as Record<string, unknown>).name;
    if (fields.length !== 1 || fields[0] !== "name" || typeof rawName !== "string") {
      return jsonResponse(res, 400, { error: "space_name_invalid" });
    }
    const name = rawName.trim();
    if (name === "" || name.length > 100) {
      return jsonResponse(res, 400, { error: "space_name_invalid" });
    }

    try {
      const upstreamPath = `/api/spaces/${encodeURIComponent(spaceId)}`;
      const currentResponse = await workspaceClient.request(upstreamPath, {
        headers: { accept: "application/json" },
      });
      if (currentResponse.status === 401) {
        return jsonResponse(res, 401, { error: "workspace_authentication_required" });
      }
      if (currentResponse.status === 404) {
        return jsonResponse(res, 404, { error: "space_not_found" });
      }
      if (!currentResponse.ok) {
        console.warn(`[uwh] Workspace Space lookup answered ${currentResponse.status}`);
        return jsonResponse(res, 502, { error: "workspace_unavailable" });
      }
      const current = workspaceApiSpaceView(await currentResponse.json());
      if (current === undefined || current.id !== spaceId) {
        console.warn("[uwh] Workspace Space lookup returned an invalid payload");
        return jsonResponse(res, 502, { error: "workspace_unavailable" });
      }
      if (!current.capabilities.renameSpace) {
        return jsonResponse(res, 403, { error: "space_rename_forbidden" });
      }

      const updateResponse = await workspaceClient.request(upstreamPath, {
        method: "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (updateResponse.status === 400) {
        return jsonResponse(res, 400, { error: "space_name_invalid" });
      }
      if (updateResponse.status === 401) {
        return jsonResponse(res, 401, { error: "workspace_authentication_required" });
      }
      if (updateResponse.status === 403) {
        return jsonResponse(res, 403, { error: "space_rename_forbidden" });
      }
      if (updateResponse.status === 404) {
        return jsonResponse(res, 404, { error: "space_not_found" });
      }
      if (!updateResponse.ok) {
        console.warn(`[uwh] Workspace Space update answered ${updateResponse.status}`);
        return jsonResponse(res, 502, { error: "workspace_unavailable" });
      }
      const updated = workspaceApiSpaceView(await updateResponse.json());
      if (updated === undefined || updated.id !== spaceId) {
        console.warn("[uwh] Workspace Space update returned an invalid payload");
        return jsonResponse(res, 502, { error: "workspace_unavailable" });
      }
      return jsonResponse(res, 200, { space: { spaceId: updated.id, name: updated.name } });
    } catch (error: unknown) {
      console.warn("[uwh] Workspace Space rename proxy failed", error);
      return jsonResponse(res, 502, { error: "workspace_unavailable" });
    }
  };
}

/** Read and parse a bounded JSON request body (empty body -> `{}`). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = chunk as Buffer;
    length += bytes.byteLength;
    if (length > JSON_REQUEST_MAX_BYTES) throw new Error("request body too large");
    chunks.push(bytes);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text) as unknown;
}

/** Restrict a return-to path to an in-site path (never an open redirect). */
function sanitizeReturnTo(pathname: string): string {
  if (pathname === "" || pathname === "/" || pathname === "/auth/login") return "/";
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) return "/";
  return pathname;
}

/**
 * Register the Harness routes plus the workspaceAuth service with the webserver.
 */
export function apply(ctx: Context, config: Config): void {
  assertHttpOrigin(config.publicOrigin, "publicOrigin");
  assertHttpOrigin(config.workspaceOrigin, "workspaceOrigin");
  // The stock frontend ships DeepSeek title and favicon markup. Rewrite the
  // server-rendered shell through the public webserver tap so the first paint
  // is branded before the browser client mounts.
  ctx.effect(
    () => ctx.webServer.tapIndex(rewriteHarnessIndexBranding),
    "uwh: server-rendered document branding",
  );
  // The stock frontend manifest and favicon are static fallback assets, so an
  // index transform alone cannot change a direct `/manifest.webmanifest` or
  // `/favicon.svg` request.  Exact routes keep those URLs stable while making
  // the returned metadata and icon Workspace-owned.
  ctx.effect(() => {
    const disposeFavicon = ctx.webServer.register({
      kind: "exact",
      path: "/favicon.svg",
      handler: (req, res) => serveBrandAsset(req, res, "image/svg+xml; charset=utf-8", WORKSPACE_FAVICON_SVG),
    });
    const disposeManifest = ctx.webServer.register({
      kind: "exact",
      path: "/manifest.webmanifest",
      handler: (req, res) => serveBrandAsset(req, res, "application/manifest+json; charset=utf-8", WORKSPACE_MANIFEST_JSON),
    });
    return () => {
      disposeManifest();
      disposeFavicon();
    };
  }, "uwh: Workspace favicon and manifest assets");

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
  const client: AuthClient = {
    resolveByPath: path => ctx.workspaceRegistry.resolveByPath(path),
    create: (path, title) => ctx.workspaceRegistry.create(path, title),
    createSession: (id, options) => ctx.sessions.create(id, options),
    load: sourceId => ctx.sessionPersistence.load(sourceId),
  };
  const loginAttempts = new Map<string, LoginAttempt>();
  const callbackUrl = callbackUrlFor(config.publicOrigin, config.callbackPath);
  ctx.effect(() => {
    const routes = [
      ctx.webServer.register({ kind: "exact", path: config.loginPath, handler: createLoginHandler(config, loginAttempts, callbackUrl) }),
      ctx.webServer.register({ kind: "exact", path: config.callbackPath, handler: createCallbackHandler(ctx, config, loginAttempts, callbackUrl) }),
      ctx.webServer.register({ kind: "exact", path: config.mePath, handler: createIdentityHandler(client, config) }),
      ctx.webServer.register({ kind: "exact", path: config.templateForkPath, handler: createTemplateForkHandler(client, config) }),
      ctx.webServer.register({ kind: "prefix", path: UWH_SPACES_PATH, handler: createSpaceRenameHandler(workspaceAuth, config) }),
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
  }, "uwh: oauth login/callback + identity + template-fork routes");
}
