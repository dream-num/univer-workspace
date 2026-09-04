/**
 * Pure host-side authentication helpers for the direct Workspace OAuth flow.
 *
 * The harness acts as an OAuth Client against the generic Workspace
 * authorization server. These helpers are node/cordis-free (only `node:crypto`
 * and `node:url`), so they are unit-testable and reused by both the login
 * handler and the focused host test. They own two secrets:
 *
 *  - the client secret, sent only in the server-side token exchange;
 *  - the short-lived HttpOnly session-cookie signing secret, held by the
 *    harness.
 *
 * Neither reaches the browser. The token endpoint returns both an identity
 * and, for a `session` grant, a Workspace login session token; the latter is
 * kept server-side as the per-User credential for product and collaboration
 * calls.
 * @module @univerjs/univer-workspace-harness/auth
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { UwhIdentity } from "./contract.ts";

/** A resolved Workspace identity after a successful token exchange. */
export type AuthIdentity = UwhIdentity;

/** One in-flight login attempt kept in memory between `/auth/login` and `/auth/callback`. */
export interface LoginAttempt {
  /** The PKCE verifier for the authorization code exchange. */
  verifier: string;
  /** The browser path to return to after the callback completes. */
  returnTo: string;
  /** Unix milliseconds when the login attempt becomes invalid. */
  expiresAt: number;
}

/** Cookie payload for the short-lived HttpOnly session cookie. */
export interface SessionIdentity {
  /** Opaque Workspace user id. */
  sub: string;
  /** Human-readable username. */
  username: string;
  /** Optional display name. */
  displayName?: string;
  /** Unix seconds when the session expires. */
  exp: number;
}

/** The token endpoint result: the identity plus the optional session credential. */
export interface TokenExchangeResult {
  /** The resolved Workspace identity. */
  identity: AuthIdentity;
  /** `workspace_session` token for a `session` grant; empty for identity-only. */
  accessToken: string;
  /** Lifetime of `accessToken` in seconds (0 when no token was granted). */
  expiresIn: number;
}

/** Base64url encode a byte buffer (no padding). */
function base64Url(data: Uint8Array): string {
  return Buffer.from(data).toString("base64url");
}

/** Decode a base64url string back to bytes. */
function base64UrlBytes(raw: string): Uint8Array {
  return new Uint8Array(Buffer.from(raw, "base64url"));
}

/** Random URL-safe state token for the authorize request. */
export function randomState(): string {
  return base64Url(new Uint8Array(randomBytes(24)));
}

/** Random PKCE verifier (43–128 chars, URL-safe). */
export function randomPkceVerifier(): string {
  return base64Url(new Uint8Array(randomBytes(32)));
}

/** PKCE S256 code challenge derived from a verifier. */
export function pkceChallenge(verifier: string): string {
  return base64Url(new Uint8Array(createHash("sha256").update(verifier, "utf8").digest()));
}

/**
 * Build the absolute callback URL from the deployment's `publicOrigin` and the
 * callback route path. The redirect URI is derived from deployment config, never
 * from the client-supplied Host header.
 */
export function callbackUrlFor(publicOrigin: string, callbackPath: string): string {
  return new URL(callbackPath, publicOrigin).toString();
}

/** Build the authorize endpoint query string for the Workspace OAuth flow. */
export function buildAuthorizeUrl(
  authorizeUrl: string,
  params: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    codeChallenge: string;
  },
): string {
  const url = new URL(authorizeUrl);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: params.scope,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** The authorize endpoint path on the Workspace origin. */
export const WORKSPACE_AUTHORIZE_PATH = "/api/auth/authorize";

/** The token endpoint path on the Workspace origin. */
export const WORKSPACE_TOKEN_PATH = "/api/auth/token";

/** Build the authorize endpoint URL from the workspace origin and the request parameters. */
export function workspaceAuthorizeUrl(
  workspaceOrigin: string,
  params: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    codeChallenge: string;
  },
): string {
  return buildAuthorizeUrl(new URL(WORKSPACE_AUTHORIZE_PATH, workspaceOrigin).toString(), params);
}

/** Build the token endpoint URL from the workspace origin. */
export function workspaceTokenUrl(workspaceOrigin: string): string {
  return new URL(WORKSPACE_TOKEN_PATH, workspaceOrigin).toString();
}

/**
 * Exchange an authorization code for a Workspace identity and, on a `session`
 * grant, a Workspace login session token.
 */
export async function exchangeCode(
  tokenUrl: string,
  params: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    verifier: string;
  },
): Promise<TokenExchangeResult> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code_verifier: params.verifier,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`workspace token endpoint answered ${response.status}`);
  }
  const raw: unknown = await response.json();
  const result = extractTokenExchange(raw);
  if (result === undefined) {
    throw new Error("workspace token endpoint did not return a usable identity");
  }
  return result;
}

/**
 * Extract the identity and optional session credential from a token response.
 * The Workspace is a generic authorization server: identity may arrive under
 * `{ sub, username, displayName }`, `{ identity: {...} }`, or `{ user: {...} }`.
 */
export function extractTokenExchange(raw: unknown): TokenExchangeResult | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const top = raw as Record<string, unknown>;
  const identity = extractIdentity(top);
  if (identity === undefined) return undefined;
  const accessToken = typeof top.access_token === "string" ? top.access_token : "";
  const expiresIn = typeof top.expires_in === "number" && Number.isFinite(top.expires_in)
    ? Math.max(0, Math.floor(top.expires_in))
    : 0;
  return { identity, accessToken, expiresIn };
}

/**
 * Extract the minimum identity from a token response. Only plain scalar values
 * are read; everything else is ignored.
 */
export function extractIdentity(raw: unknown): AuthIdentity | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const top = raw as Record<string, unknown>;
  const source = (top.identity !== null && typeof top.identity === "object"
    ? top.identity
    : top.user !== null && typeof top.user === "object"
      ? top.user
      : top) as Record<string, unknown>;
  const userId = firstString(source, "sub", "userId", "id");
  const username = firstString(source, "username", "name");
  if (userId === undefined || username === undefined) return undefined;
  const displayName = firstString(source, "displayName", "display_name");
  const identity: AuthIdentity = { userId, username };
  if (displayName !== undefined) identity.displayName = displayName;
  return identity;
}

/** First non-blank string value among several keys. */
function firstString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed !== "") return trimmed;
  }
  return undefined;
}

/** Parse a `Cookie` header into a name → value map (cookie names case-sensitive). */
export function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (header === undefined) return result;
  const text = Array.isArray(header) ? header.join(";") : header;
  for (const segment of text.split(";")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const name = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (name !== "") result.set(name, value);
  }
  return result;
}

/**
 * Sign a session-cookie value for the given identity and TTL.
 * @returns the `payload.signature` cookie value.
 */
export function signSessionCookie(identity: AuthIdentity, secret: string, ttlMs: number): string {
  const now = Math.floor(Date.now() / 1000);
  const session: SessionIdentity = {
    sub: identity.userId,
    username: identity.username,
    exp: now + Math.floor(ttlMs / 1000),
  };
  if (identity.displayName !== undefined) session.displayName = identity.displayName;
  const payload = base64Url(new Uint8Array(Buffer.from(JSON.stringify(session), "utf8")));
  const signature = hmac(secret, payload);
  return `${payload}.${signature}`;
}

/**
 * Verify and decode a session-cookie value.
 * @returns the decoded identity, or `undefined` when invalid, tampered, or expired.
 */
export function parseSessionCookie(value: string | undefined, secret: string): AuthIdentity | undefined {
  if (value === undefined) return undefined;
  const dot = value.indexOf(".");
  if (dot === -1) return undefined;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!timingSafeEqualBytes(signature, hmac(secret, payload))) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(base64UrlBytes(payload)).toString("utf8"));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const session = parsed as SessionIdentity;
  if (typeof session.sub !== "string" || session.sub === ""
    || typeof session.username !== "string" || session.username === ""
    || typeof session.exp !== "number" || !Number.isSafeInteger(session.exp)) {
    return undefined;
  }
  if (session.exp <= Math.floor(Date.now() / 1000)) return undefined;
  const identity: AuthIdentity = { userId: session.sub, username: session.username };
  if (typeof session.displayName === "string" && session.displayName !== "") {
    identity.displayName = session.displayName;
  }
  return identity;
}

/** Constant-time HMAC-SHA256 of a payload, hex-encoded. */
function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Constant-time byte comparison of two hex strings. */
function timingSafeEqualBytes(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}
