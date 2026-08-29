import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { ApplicationError } from "../../errors.js";
import type {
  ExternalIdentity,
  GitHubOAuthProvider,
} from "../../github-oauth.js";
import {
  ObservationInitializationConflict,
  ObservationRepository,
} from "./observation-repository.js";
import type { ObservationMember } from "./observation-types.js";

const SESSION_COOKIE = "univer_observer_session";
const OAUTH_COOKIE = "univer_observer_github_oauth";
const OAUTH_TTL_MS = 10 * 60 * 1000;

export interface ObservationModule {
  readonly cookieName: string;
  readonly oauthCookieName: string;
  readonly sessionTtlMs: number;
  status(cookieHeader: string | undefined): {
    readonly initialized: boolean;
    readonly setupTokenConfigured: boolean;
    readonly githubOAuthEnabled: boolean;
    readonly authenticated: boolean;
    readonly member?: ObservationMember;
  };
  requireMember(cookieHeader: string | undefined): ObservationMember;
  startOAuth(input: {
    readonly mode: "setup" | "login";
    readonly setupToken?: unknown;
    readonly returnTo?: unknown;
  }): { readonly authorizationUrl: string; readonly cookieValue: string };
  finishOAuth(input: {
    readonly code: unknown;
    readonly state: unknown;
    readonly providerError: unknown;
    readonly cookieHeader: string | undefined;
  }): Promise<{
    readonly returnTo: string;
    readonly sessionCookieValue: string;
    readonly member: ObservationMember;
  }>;
  logout(cookieHeader: string | undefined): void;
  listMembers(cookieHeader: string | undefined): readonly ObservationMember[];
  addMember(cookieHeader: string | undefined, loginOrUrl: unknown): Promise<ObservationMember>;
  removeMember(cookieHeader: string | undefined, githubUserId: unknown): void;
  listEvents(cookieHeader: string | undefined, limit?: number): ReturnType<ObservationRepository["listEvents"]>;
}

export function createObservationModule(options: {
  readonly repository: ObservationRepository;
  readonly githubOAuthProvider?: GitHubOAuthProvider | null;
  readonly oauthStateSecret?: string;
  readonly setupToken?: string;
  readonly sessionTtlMs: number;
  readonly now?: () => number;
  readonly resolveGitHubIdentity?: (login: string) => Promise<ExternalIdentity>;
}): ObservationModule {
  const repository = options.repository;
  const now = options.now ?? Date.now;
  const provider = options.githubOAuthProvider ?? null;
  const stateSecret = options.oauthStateSecret ?? "";
  const setupToken = options.setupToken;
  const resolveIdentity = options.resolveGitHubIdentity ?? resolvePublicGitHubIdentity;
  repository.deleteExpiredSessions(now());

  function getMember(cookieHeader: string | undefined): ObservationMember | null {
    const token = readCookie(cookieHeader, SESSION_COOKIE);
    const parsed = token ? parseSessionToken(token) : null;
    if (!parsed) return null;
    const stored = repository.findSession(parsed.id);
    if (!stored) return null;
    if (stored.expiresAt <= now()) {
      repository.deleteSession(stored.sessionId);
      return null;
    }
    if (!safeEqual(hashSecret(parsed.secret), stored.secretHash)) return null;
    return stored.member;
  }

  function requireMember(cookieHeader: string | undefined): ObservationMember {
    const member = getMember(cookieHeader);
    if (!member) {
      throw new ApplicationError("UNAUTHENTICATED", 401, "Observer authentication is required.");
    }
    return member;
  }

  function issueSession(identity: ExternalIdentity): {
    readonly cookieValue: string;
    readonly stored: { readonly id: string; readonly secretHash: string; readonly createdAt: number; readonly expiresAt: number };
  } {
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const createdAt = now();
    return {
      cookieValue: `${id}.${secret}`,
      stored: {
        id,
        secretHash: hashSecret(secret),
        createdAt,
        expiresAt: createdAt + options.sessionTtlMs,
      },
    };
  }

  return {
    cookieName: SESSION_COOKIE,
    oauthCookieName: OAUTH_COOKIE,
    sessionTtlMs: options.sessionTtlMs,
    status(cookieHeader) {
      const member = getMember(cookieHeader);
      return {
        initialized: repository.memberCount() > 0,
        setupTokenConfigured: Boolean(setupToken),
        githubOAuthEnabled: Boolean(provider && stateSecret),
        authenticated: Boolean(member),
        ...(member ? { member } : {}),
      };
    },
    requireMember,
    startOAuth(input) {
      if (!provider || !stateSecret) {
        throw new ApplicationError(
          "GITHUB_OAUTH_UNAVAILABLE",
          503,
          "Observer GitHub OAuth is not configured."
        );
      }
      const initialized = repository.memberCount() > 0;
      if (input.mode === "setup") {
        if (initialized) {
          throw new ApplicationError(
            "OBSERVER_ALREADY_INITIALIZED",
            409,
            "Observer is already initialized."
          );
        }
        if (!setupToken) {
          throw new ApplicationError(
            "OBSERVER_SETUP_UNAVAILABLE",
            503,
            "OBSERVER_SETUP_TOKEN is not configured."
          );
        }
        if (typeof input.setupToken !== "string" || !safeEqual(input.setupToken, setupToken)) {
          throw new ApplicationError(
            "OBSERVER_SETUP_TOKEN_INVALID",
            403,
            "Observer setup token is invalid."
          );
        }
      } else if (!initialized) {
        throw new ApplicationError(
          "OBSERVER_NOT_INITIALIZED",
          409,
          "Observer has not been initialized."
        );
      }
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      const oauthState: OAuthState = {
        state,
        verifier,
        mode: input.mode,
        returnTo: validReturnTo(input.returnTo),
        expiresAt: now() + OAUTH_TTL_MS,
      };
      return {
        authorizationUrl: provider.authorizationUrl({
          state,
          codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
        }),
        cookieValue: signState(oauthState, stateSecret),
      };
    },
    async finishOAuth(input) {
      if (!provider || !stateSecret) {
        throw new ApplicationError("GITHUB_OAUTH_UNAVAILABLE", 503, "Observer GitHub OAuth is not configured.");
      }
      if (typeof input.providerError === "string" && input.providerError) {
        throw new ApplicationError("GITHUB_OAUTH_FAILED", 400, "GitHub authorization was cancelled.");
      }
      if (typeof input.code !== "string" || typeof input.state !== "string") {
        throw new ApplicationError("GITHUB_OAUTH_FAILED", 400, "GitHub OAuth response is incomplete.");
      }
      const signed = readCookie(input.cookieHeader, OAUTH_COOKIE);
      const oauth = signed ? verifyState(signed, stateSecret) : null;
      if (!oauth || oauth.expiresAt <= now() || oauth.state !== input.state) {
        throw new ApplicationError("GITHUB_OAUTH_FAILED", 400, "GitHub OAuth state is invalid or expired.");
      }
      const identity = await provider.exchangeCode(input.code, oauth.verifier);
      const issued = issueSession(identity);
      let member: ObservationMember;
      if (oauth.mode === "setup") {
        try {
          member = repository.initialize(identity, issued.stored, randomUUID(), now());
        } catch (error) {
          if (error instanceof ObservationInitializationConflict) {
            throw new ApplicationError(
              "OBSERVER_ALREADY_INITIALIZED",
              409,
              "Observer was initialized by another request."
            );
          }
          throw error;
        }
      } else {
        const authenticated = repository.refreshAndCreateSession(identity, issued.stored, now());
        if (!authenticated) {
          throw new ApplicationError("FORBIDDEN", 403, "This GitHub identity is not an Observer Member.");
        }
        member = authenticated;
      }
      return {
        returnTo: oauth.returnTo,
        sessionCookieValue: issued.cookieValue,
        member,
      };
    },
    logout(cookieHeader) {
      const raw = readCookie(cookieHeader, SESSION_COOKIE);
      const token = raw ? parseSessionToken(raw) : null;
      if (token) repository.deleteSession(token.id);
    },
    listMembers(cookieHeader) {
      requireMember(cookieHeader);
      return repository.listMembers();
    },
    async addMember(cookieHeader, loginOrUrl) {
      const actor = requireMember(cookieHeader);
      const login = validGitHubLogin(loginOrUrl);
      const identity = await resolveIdentity(login);
      return repository.addMember(actor, identity, randomUUID(), now());
    },
    removeMember(cookieHeader, githubUserId) {
      const actor = requireMember(cookieHeader);
      if (typeof githubUserId !== "string" || !/^\d+$/.test(githubUserId)) {
        throw new ApplicationError("INVALID_INPUT", 400, "GitHub User ID is invalid.", "githubUserId");
      }
      const target = repository.findMember(githubUserId);
      if (!target) throw new ApplicationError("NOT_FOUND", 404, "Observer Member was not found.");
      if (repository.removeMember(actor, target, randomUUID(), now()) === "last-member") {
        throw new ApplicationError("CONFLICT", 409, "The last Observer Member cannot be removed.");
      }
    },
    listEvents(cookieHeader, limit = 100) {
      requireMember(cookieHeader);
      return repository.listEvents(Math.max(1, Math.min(500, limit)));
    },
  };
}

interface OAuthState {
  readonly state: string;
  readonly verifier: string;
  readonly mode: "setup" | "login";
  readonly returnTo: string;
  readonly expiresAt: number;
}

function signState(state: OAuthState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyState(value: string, secret: string): OAuthState | null {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OAuthState>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      (parsed.mode !== "setup" && parsed.mode !== "login") ||
      typeof parsed.returnTo !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) return null;
    return parsed as OAuthState;
  } catch {
    return null;
  }
}

function validReturnTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

function validGitHubLogin(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApplicationError("INVALID_INPUT", 400, "GitHub login is required.", "githubLogin");
  }
  const trimmed = value.trim();
  let login = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try { url = new URL(trimmed); } catch {
      throw new ApplicationError("INVALID_INPUT", 400, "GitHub profile URL is invalid.", "githubLogin");
    }
    if (url.hostname.toLowerCase() !== "github.com") {
      throw new ApplicationError("INVALID_INPUT", 400, "Only github.com profile URLs are supported.", "githubLogin");
    }
    login = url.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) {
    throw new ApplicationError("INVALID_INPUT", 400, "GitHub login is invalid.", "githubLogin");
  }
  return login;
}

async function resolvePublicGitHubIdentity(login: string): Promise<ExternalIdentity> {
  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "univer-observer",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (response.status === 404) throw new ApplicationError("NOT_FOUND", 404, "GitHub user was not found.");
  if (!response.ok) throw new ApplicationError("GITHUB_OAUTH_FAILED", 502, "GitHub user profile could not be loaded.");
  const user = await response.json() as Record<string, unknown>;
  if ((typeof user.id !== "number" && typeof user.id !== "string") || typeof user.login !== "string") {
    throw new ApplicationError("GITHUB_OAUTH_FAILED", 502, "GitHub user profile is invalid.");
  }
  return {
    subject: String(user.id),
    username: user.login,
    displayName: typeof user.name === "string" && user.name.trim() ? user.name.trim() : user.login,
    avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
  };
}

function parseSessionToken(value: string): { readonly id: string; readonly secret: string } | null {
  const [id, secret, extra] = value.split(".");
  return id && secret && !extra ? { id, secret } : null;
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}
