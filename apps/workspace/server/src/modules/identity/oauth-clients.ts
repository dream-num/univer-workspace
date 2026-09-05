import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type { User } from "./identity.types.js";

const CODE_TTL_MS = 60_000;
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const DEFAULT_SCOPES = ["identity"] as const;

/**
 * The `session` scope authorizes the client to receive a Workspace login
 * session token from the token endpoint. Grants without it stay
 * identity-only, so existing registered clients keep their behavior.
 */
export const OAUTH_SESSION_SCOPE = "session";

export interface OAuthClient {
  readonly clientId: string;
  readonly clientType?: "confidential" | "public";
  readonly clientSecret?: string;
  readonly requiresConsent?: boolean;
  readonly redirectUris: readonly string[];
  readonly scopes: readonly string[];
}

export interface OAuthClientConfig {
  readonly clients: readonly OAuthClient[];
}

export interface IssuedAuthorization {
  readonly code: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly scope: string;
  readonly user: User;
  readonly expiresAt: number;
}

export function requireOAuthState(value: unknown): string {
  if (typeof value !== "string" || !STATE_PATTERN.test(value)) {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      "state must be a 32 to 256 character base64url value."
    );
  }
  return value;
}

export function validateOAuthClientSecret(
  provided: string | undefined,
  expected: string
): void {
  if (provided === undefined || !secretsMatch(provided, expected)) {
    throw new ApplicationError(
      "INVALID_CLIENT_SECRET",
      401,
      "A valid client secret is required."
    );
  }
}

export function validateOAuthClientAuthentication(
  client: OAuthClient,
  provided: string | undefined,
): void {
  if (client.clientType === "public") {
    if (provided !== undefined) {
      throw new ApplicationError("INVALID_INPUT", 400, "Public OAuth clients must not send a client secret.");
    }
    return;
  }
  if (client.clientSecret === undefined) {
    throw new ApplicationError("OAUTH_CLIENT_UNAVAILABLE", 400, "The OAuth client is missing a secret.");
  }
  validateOAuthClientSecret(provided, client.clientSecret);
}

export function validateOAuthCodeVerifier(
  provided: string | undefined,
  expectedChallenge: string
): void {
  if (provided === undefined || sha256Base64Url(provided) !== expectedChallenge) {
    throw new ApplicationError(
      "INVALID_CODE_VERIFIER",
      401,
      "A valid PKCE code verifier is required."
    );
  }
}

export function requireOAuthCodeChallenge(value: unknown): string {
  if (typeof value !== "string" || !PKCE_CHALLENGE_PATTERN.test(value)) {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      "code_challenge must be a base64url PKCE value.",
    );
  }
  return value;
}

export function validateRegisteredRedirectUri(
  requested: unknown,
  allowed: readonly string[]
): string {
  if (typeof requested !== "string") {
    throw new ApplicationError("INVALID_INPUT", 400, "redirect_uri is required.");
  }
  const parsed = new URL(requested);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApplicationError(
      "INVALID_REDIRECT_URI",
      400,
      "redirect_uri must use http or https."
    );
  }
  if (!allowed.includes(parsed.toString())) {
    throw new ApplicationError(
      "INVALID_REDIRECT_URI",
      400,
      "redirect_uri is not registered for this client."
    );
  }
  return parsed.toString();
}

export function issueOAuthAuthorizationCode(
  clientId: string,
  state: string,
  codeChallenge: string,
  redirectUri: string,
  scope: string,
  user: User,
  now: number = Date.now()
): IssuedAuthorization {
  verifyState(state);
  return {
    code: randomBytes(24).toString("base64url"),
    codeChallenge,
    redirectUri,
    clientId,
    scope,
    user,
    expiresAt: now + CODE_TTL_MS,
  };
}

export function requireOAuthAuthorization(
  authorization: IssuedAuthorization,
  input: {
    readonly code: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
    readonly now: number;
  }
): User {
  if (input.now >= authorization.expiresAt) {
    throw new ApplicationError("INVALID_GRANT", 400, "authorization code expired.");
  }
  if (input.clientId !== authorization.clientId) {
    throw new ApplicationError("INVALID_GRANT", 400, "client_id does not match.");
  }
  if (input.redirectUri !== authorization.redirectUri) {
    throw new ApplicationError(
      "INVALID_GRANT",
      400,
      "redirect_uri does not match the authorization request."
    );
  }
  validateOAuthCodeVerifier(input.codeVerifier, authorization.codeChallenge);
  if (input.code !== authorization.code) {
    throw new ApplicationError("INVALID_GRANT", 400, "authorization code is invalid.");
  }
  return authorization.user;
}

export function authorizeRedirectTarget(
  input: {
    readonly redirectUri: string;
    readonly state: string;
    readonly scope: string;
  },
  code: string
): string {
  const target = new URL(input.redirectUri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", input.state);
  target.searchParams.set("scope", input.scope);
  return target.toString();
}

export function scopeIncludesSession(scope: string): boolean {
  return scope
    .split(" ")
    .some((value) => value === OAUTH_SESSION_SCOPE);
}

export function defaultOAuthScope(): string {
  return DEFAULT_SCOPES.join(" ");
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function verifyState(state: string): void {
  if (!STATE_PATTERN.test(state)) {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      "state must be a 32 to 256 character base64url value."
    );
  }
}
