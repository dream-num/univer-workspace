import { randomBytes, randomUUID } from "node:crypto";
import type { AccessTokenRepository, GrantSecrets, TokenCredential } from "./access-token.repository.js";
import { ApplicationError } from "../../middleware/errors.js";
import { hashSessionSecret } from "./session-token.js";

export const MCP_SCOPES = ["read", "write", "publish", "worktree:merge"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_REUSE_GRACE_MS = 60 * 1000;

const PAT_PREFIX = "uvw_pat_";
const ACCESS_PREFIX = "uvw_at_";
const REFRESH_PREFIX = "uvw_rt_";
const MAX_TOKEN_NAME_LENGTH = 100;

export interface PersonalTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly scopes: readonly McpScope[];
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
}

export interface OAuthGrantRecord {
  readonly id: string;
  readonly userId: string;
  readonly clientId: string;
  readonly scopes: readonly McpScope[];
  readonly resource: string;
  readonly accessExpiresAt: number;
  readonly refreshExpiresAt: number;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
}

export interface IssuedGrant {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly grant: OAuthGrantRecord;
}

export type RefreshFailure = "invalid" | "revoked" | "expired" | "retired" | "reused" | "client_mismatch" | "resource_mismatch";
export type RefreshResult = ({ readonly ok: true } & IssuedGrant) | { readonly ok: false; readonly reason: RefreshFailure };

export type SubjectToken =
  | { readonly kind: "pat"; readonly id: string; readonly userId: string; readonly scopes: readonly McpScope[]; readonly expiresAt: number | null }
  | { readonly kind: "oauth"; readonly id: string; readonly userId: string; readonly scopes: readonly McpScope[]; readonly expiresAt: number; readonly clientId: string };

export interface OAuthClientRecord {
  readonly clientId: string;
  readonly clientName: string | null;
  readonly redirectUris: readonly string[];
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
}

/** Token formats, scope validation and lifetimes shared by all persistence backends. */
export function createAccessTokenService(options: {
  readonly repository: AccessTokenRepository;
  readonly onSessionsDeleted?: (sessionIds: readonly string[]) => void;
  readonly now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const { repository } = options;

  function notifyRevocation(sessionIds: readonly string[] | null): boolean {
    if (sessionIds === null) return false;
    options.onSessionsDeleted?.(sessionIds);
    return true;
  }

  function newGrantTokens(id: string) {
    const access = mintSecret(ACCESS_PREFIX, id);
    const refresh = mintSecret(REFRESH_PREFIX, id);
    const secrets: GrantSecrets = {
      accessHash: access.hash, refreshHash: refresh.hash,
    };
    const issued = { accessToken: access.token, refreshToken: refresh.token, expiresIn: ACCESS_TOKEN_TTL_MS / 1000 };
    return { secrets, issued };
  }

  return {
    async createPersonalToken(input: {
      readonly userId: string;
      readonly name: string;
      readonly scopes?: readonly string[];
      readonly expiresAt?: number | null;
    }): Promise<{ readonly token: string; readonly record: PersonalTokenRecord }> {
      const name = input.name.trim();
      if (name.length === 0 || [...name].length > MAX_TOKEN_NAME_LENGTH) {
        throw new ApplicationError("INVALID_INPUT", 400, `Token name must be 1 to ${MAX_TOKEN_NAME_LENGTH} characters.`, "name");
      }
      const scopes = normalizeScopes(input.scopes ?? MCP_SCOPES);
      const minted = mint(PAT_PREFIX);
      const createdAt = now();
      if (input.expiresAt != null && (!Number.isInteger(input.expiresAt) || input.expiresAt <= createdAt)) {
        throw new ApplicationError("INVALID_INPUT", 400, "expiresAt must be an integer timestamp in the future.", "expiresAt");
      }
      const record: PersonalTokenRecord = {
        id: minted.id, userId: input.userId, name, scopes, createdAt,
        expiresAt: input.expiresAt ?? null, lastUsedAt: null, revokedAt: null,
      };
      await repository.insertPersonal(record, minted.hash);
      return { token: minted.token, record };
    },

    async listPersonalTokens(userId: string): Promise<PersonalTokenRecord[]> {
      return repository.listPersonal(userId);
    },

    async revokePersonalToken(userId: string, id: string): Promise<boolean> {
      return notifyRevocation(await repository.revokePersonal(userId, id, now()));
    },

    async issueGrant(input: {
      readonly userId: string;
      readonly clientId: string;
      readonly scopes: readonly string[];
      readonly resource: string;
    }): Promise<IssuedGrant> {
      const scopes = normalizeScopes(input.scopes);
      if (input.resource.trim().length === 0) {
        throw new ApplicationError("INVALID_INPUT", 400, "resource is required.", "resource");
      }
      const id = randomUUID();
      const createdAt = now();
      const { secrets, issued } = newGrantTokens(id);
      const grant: OAuthGrantRecord = {
        ...input, id, scopes, accessExpiresAt: createdAt + ACCESS_TOKEN_TTL_MS, refreshExpiresAt: createdAt + REFRESH_TOKEN_TTL_MS,
        createdAt, lastUsedAt: null, revokedAt: null,
      };
      await repository.insertGrant(grant, secrets);
      return { ...issued, grant };
    },

    async refreshGrant(input: {
      readonly refreshToken: string;
      readonly clientId: string;
      readonly resource?: string | undefined;
    }): Promise<RefreshResult> {
      const parsed = parseToken(input.refreshToken, REFRESH_PREFIX);
      if (!parsed) return { ok: false, reason: "invalid" };
      const { secrets, issued } = newGrantTokens(parsed.id);
      const result = await repository.rotateGrant({ ...parsed, clientId: input.clientId, resource: input.resource, now, next: secrets });
      if (result.ok) return { ok: true, ...issued, grant: result.grant };
      if (result.deletedSessions) options.onSessionsDeleted?.(result.deletedSessions);
      return { ok: false, reason: result.reason };
    },

    async revokeGrant(userId: string, id: string): Promise<boolean> {
      return notifyRevocation(await repository.revokeGrant(userId, id, now()));
    },

    async revokeClientGrant(token: string, clientId: string): Promise<void> {
      const refresh = token.startsWith(REFRESH_PREFIX);
      const parsed = parseToken(token, refresh ? REFRESH_PREFIX : ACCESS_PREFIX);
      if (parsed) notifyRevocation(await repository.revokeClientGrant(parsed.id, parsed.secret, refresh, clientId, now()));
    },

    async verifySubjectToken(token: string, check: { readonly resource: string }): Promise<SubjectToken | null> {
      const parsed = parseSubjectToken(token);
      return parsed && repository.verifySubject(parsed, check.resource, now());
    },

    async exchangeSubjectToken(token: string, resource: string, maxTtlMs: number) {
      const parsed = parseSubjectToken(token);
      return parsed && repository.exchangeSubject(parsed, resource, maxTtlMs, now);
    },

    async registerClient(input: {
      readonly clientName?: string | null;
      readonly redirectUris: readonly string[];
    }, limit: number | null = null): Promise<OAuthClientRecord | null> {
      const redirectUris = [...new Set(input.redirectUris)];
      if (redirectUris.length === 0 || !redirectUris.every(isAbsoluteUrl)) {
        throw new ApplicationError("INVALID_INPUT", 400, "redirect_uris must be a non-empty list of absolute URLs.", "redirect_uris");
      }
      const client = { clientId: randomUUID(), clientName: input.clientName?.trim() || null, redirectUris, createdAt: now(), lastUsedAt: null };
      const inserted = await repository.insertClient(client, limit);
      return inserted ? client : null;
    },

    async getClient(id: string) { return repository.getClient(id); },
  };
}

function parseSubjectToken(token: string): TokenCredential | null {
  const kind = token.startsWith(PAT_PREFIX) ? "pat" : "oauth";
  const parsed = parseToken(token, kind === "pat" ? PAT_PREFIX : ACCESS_PREFIX);
  return parsed && { ...parsed, kind };
}

export type AccessTokenService = ReturnType<typeof createAccessTokenService>;

function mint(prefix: string): { id: string; token: string; hash: string } {
  const id = randomUUID();
  return { id, ...mintSecret(prefix, id) };
}

function mintSecret(prefix: string, id: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { token: `${prefix}${id}.${secret}`, hash: hashSessionSecret(secret) };
}

function parseToken(token: string, prefix: string): { id: string; secret: string } | null {
  if (!token.startsWith(prefix)) return null;
  const rest = token.slice(prefix.length);
  const separator = rest.indexOf(".");
  if (separator < 1 || separator === rest.length - 1) return null;
  return { id: rest.slice(0, separator), secret: rest.slice(separator + 1) };
}

function normalizeScopes(scopes: readonly string[]): McpScope[] {
  const requested = new Set(scopes);
  const known = MCP_SCOPES.filter((scope) => requested.delete(scope));
  if (known.length === 0 || requested.size > 0) {
    throw new ApplicationError("INVALID_INPUT", 400, `scope must be a non-empty subset of: ${MCP_SCOPES.join(", ")}.`, "scope");
  }
  return known;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
