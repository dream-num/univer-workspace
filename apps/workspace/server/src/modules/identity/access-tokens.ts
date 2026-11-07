import { randomBytes, randomUUID } from "node:crypto";
import type { WorkspaceDatabase } from "../../db/database.js";
import { ApplicationError } from "../../middleware/errors.js";
import { hashSessionSecret, secretMatches } from "./identity.service.js";

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
  | { readonly kind: "pat"; readonly id: string; readonly userId: string; readonly scopes: readonly McpScope[] }
  | { readonly kind: "oauth"; readonly id: string; readonly userId: string; readonly scopes: readonly McpScope[]; readonly clientId: string };

export interface OAuthClientRecord {
  readonly clientId: string;
  readonly clientName: string | null;
  readonly redirectUris: readonly string[];
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
}

type Row = Record<string, unknown>;

/** Persisted MCP OAuth grants, personal access tokens and dynamically registered clients. No HTTP. */
export function createAccessTokenService(options: {
  readonly database: WorkspaceDatabase;
  readonly now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const db = options.database.connection;

  function deleteSessions(column: "issued_for_pat_id" | "issued_for_grant_id", id: string): void {
    db.prepare(`DELETE FROM login_sessions WHERE ${column} = ?`).run(id);
  }

  function revokeGrantNow(id: string, userId?: string): boolean {
    const revoked = db.prepare(
      "UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND (? IS NULL OR user_id = ?)"
    ).run(now(), id, userId ?? null, userId ?? null);
    if (revoked.changes > 0) deleteSessions("issued_for_grant_id", id);
    return revoked.changes > 0;
  }

  function toIssued(row: Row, accessToken: string, refreshToken: string): IssuedGrant {
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_MS / 1000, grant: toGrant(row) };
  }

  return {
    createPersonalToken(input: {
      readonly userId: string;
      readonly name: string;
      readonly scopes?: readonly string[];
      readonly expiresAt?: number | null;
    }): { readonly token: string; readonly record: PersonalTokenRecord } {
      const name = input.name.trim();
      if (name.length === 0 || name.length > MAX_TOKEN_NAME_LENGTH) {
        throw new ApplicationError("INVALID_INPUT", 400, `Token name must be 1 to ${MAX_TOKEN_NAME_LENGTH} characters.`, "name");
      }
      const scopes = normalizeScopes(input.scopes ?? MCP_SCOPES);
      const minted = mint(PAT_PREFIX);
      const createdAt = now();
      if (input.expiresAt != null && (!Number.isInteger(input.expiresAt) || input.expiresAt <= createdAt)) {
        throw new ApplicationError("INVALID_INPUT", 400, "expiresAt must be an integer timestamp in the future.", "expiresAt");
      }
      db.prepare(
        `INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(minted.id, input.userId, name, minted.hash, scopes.join(" "), createdAt, input.expiresAt ?? null);
      return { token: minted.token, record: toPersonalToken(personalRow(minted.id)!) };
    },

    listPersonalTokens(userId: string): PersonalTokenRecord[] {
      return db.prepare("SELECT * FROM personal_access_tokens WHERE user_id = ? ORDER BY created_at DESC, id").all(userId)
        .map(toPersonalToken);
    },

    revokePersonalToken(userId: string, id: string): boolean {
      return options.database.transaction(() => {
        const revoked = db.prepare(
          "UPDATE personal_access_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
        ).run(now(), id, userId);
        if (revoked.changes > 0) deleteSessions("issued_for_pat_id", id);
        return revoked.changes > 0;
      });
    },

    issueGrant(input: {
      readonly userId: string;
      readonly clientId: string;
      readonly scopes: readonly string[];
      readonly resource: string;
    }): IssuedGrant {
      const scopes = normalizeScopes(input.scopes);
      if (input.resource.trim().length === 0) {
        throw new ApplicationError("INVALID_INPUT", 400, "resource is required.", "resource");
      }
      const id = randomUUID();
      const access = mintSecret(ACCESS_PREFIX, id);
      const refresh = mintSecret(REFRESH_PREFIX, id);
      const createdAt = now();
      return options.database.transaction(() => {
        db.prepare(
          `INSERT INTO oauth_grants
            (id, user_id, client_id, scopes, resource, access_token_hash, access_expires_at,
             refresh_token_hash, refresh_expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id, input.userId, input.clientId, scopes.join(" "), input.resource, access.hash,
          createdAt + ACCESS_TOKEN_TTL_MS, refresh.hash, createdAt + REFRESH_TOKEN_TTL_MS, createdAt
        );
        db.prepare("UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?").run(createdAt, input.clientId);
        return toIssued(grantRow(id)!, access.token, refresh.token);
      });
    },

    refreshGrant(input: {
      readonly refreshToken: string;
      readonly clientId: string;
      readonly resource: string;
    }): RefreshResult {
      const parsed = parseToken(input.refreshToken, REFRESH_PREFIX);
      if (!parsed) return { ok: false, reason: "invalid" };
      return options.database.transaction((): RefreshResult => {
        const row = grantRow(parsed.id);
        if (!row) return { ok: false, reason: "invalid" };
        const at = now();
        const current = secretMatches(parsed.secret, String(row.refresh_token_hash));
        const retired = current
          ? undefined
          : (db.prepare(
              "SELECT retired_at FROM oauth_refresh_history WHERE refresh_token_hash = ? AND grant_id = ?"
            ).get(hashSessionSecret(parsed.secret), parsed.id) as { retired_at: number } | undefined);
        if (!current && !retired) return { ok: false, reason: "invalid" };
        if (row.revoked_at !== null) return { ok: false, reason: "revoked" };
        if (Number(row.refresh_expires_at) <= at) return { ok: false, reason: "expired" };
        if (retired) {
          if (at - retired.retired_at < REFRESH_REUSE_GRACE_MS) return { ok: false, reason: "retired" };
          revokeGrantNow(parsed.id);
          return { ok: false, reason: "reused" };
        }
        if (row.client_id !== input.clientId) return { ok: false, reason: "client_mismatch" };
        if (row.resource !== input.resource) {
          return { ok: false, reason: "resource_mismatch" };
        }
        const access = mintSecret(ACCESS_PREFIX, parsed.id);
        const refresh = mintSecret(REFRESH_PREFIX, parsed.id);
        db.prepare("INSERT INTO oauth_refresh_history (refresh_token_hash, grant_id, retired_at) VALUES (?, ?, ?)")
          .run(String(row.refresh_token_hash), parsed.id, at);
        db.prepare("DELETE FROM oauth_refresh_history WHERE grant_id = ? AND retired_at < ?")
          .run(parsed.id, at - REFRESH_TOKEN_TTL_MS);
        db.prepare(
          `UPDATE oauth_grants
           SET access_token_hash = ?, access_expires_at = ?, refresh_token_hash = ?, refresh_expires_at = ?, last_used_at = ?
           WHERE id = ?`
        ).run(access.hash, at + ACCESS_TOKEN_TTL_MS, refresh.hash, at + REFRESH_TOKEN_TTL_MS, at, parsed.id);
        return { ok: true, ...toIssued(grantRow(parsed.id)!, access.token, refresh.token) };
      });
    },

    revokeGrant(userId: string, id: string): boolean {
      return options.database.transaction(() => revokeGrantNow(id, userId));
    },

    verifySubjectToken(token: string, check: { readonly resource: string }): SubjectToken | null {
      const at = now();
      const pat = parseToken(token, PAT_PREFIX);
      if (pat) {
        const row = personalRow(pat.id);
        if (
          !row || !secretMatches(pat.secret, String(row.token_hash)) || row.revoked_at !== null ||
          (row.expires_at !== null && Number(row.expires_at) <= at)
        ) return null;
        db.prepare("UPDATE personal_access_tokens SET last_used_at = ? WHERE id = ?").run(at, pat.id);
        return { kind: "pat", id: pat.id, userId: String(row.user_id), scopes: toScopes(row.scopes) };
      }
      const access = parseToken(token, ACCESS_PREFIX);
      if (!access) return null;
      const row = grantRow(access.id);
      if (
        !row || !secretMatches(access.secret, String(row.access_token_hash)) || row.revoked_at !== null ||
        Number(row.access_expires_at) <= at ||
        row.resource !== check.resource
      ) return null;
      db.prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?").run(at, access.id);
      return {
        kind: "oauth", id: access.id, userId: String(row.user_id), scopes: toScopes(row.scopes),
        clientId: String(row.client_id),
      };
    },

    registerClient(input: {
      readonly clientName?: string | null;
      readonly redirectUris: readonly string[];
    }): OAuthClientRecord {
      const redirectUris = [...new Set(input.redirectUris)];
      if (redirectUris.length === 0 || !redirectUris.every(isAbsoluteUrl)) {
        throw new ApplicationError("INVALID_INPUT", 400, "redirect_uris must be a non-empty list of absolute URLs.", "redirect_uris");
      }
      const clientId = randomUUID();
      db.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
        .run(clientId, input.clientName?.trim() || null, JSON.stringify(redirectUris), now());
      return getClient(clientId)!;
    },

    getClient,
  };

  function getClient(clientId: string): OAuthClientRecord | null {
    const row = db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as Row | undefined;
    return row
      ? {
          clientId: String(row.client_id),
          clientName: (row.client_name as string | null) ?? null,
          redirectUris: JSON.parse(String(row.redirect_uris)) as string[],
          createdAt: Number(row.created_at),
          lastUsedAt: (row.last_used_at as number | null) ?? null,
        }
      : null;
  }

  function personalRow(id: string): Row | undefined {
    return db.prepare("SELECT * FROM personal_access_tokens WHERE id = ?").get(id) as Row | undefined;
  }

  function grantRow(id: string): Row | undefined {
    return db.prepare("SELECT * FROM oauth_grants WHERE id = ?").get(id) as Row | undefined;
  }
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

function toScopes(value: unknown): McpScope[] {
  return MCP_SCOPES.filter((scope) => String(value).split(" ").includes(scope));
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function toPersonalToken(row: Row): PersonalTokenRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    scopes: toScopes(row.scopes),
    createdAt: Number(row.created_at),
    expiresAt: (row.expires_at as number | null) ?? null,
    lastUsedAt: (row.last_used_at as number | null) ?? null,
    revokedAt: (row.revoked_at as number | null) ?? null,
  };
}

function toGrant(row: Row): OAuthGrantRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    clientId: String(row.client_id),
    scopes: toScopes(row.scopes),
    resource: String(row.resource),
    accessExpiresAt: Number(row.access_expires_at),
    refreshExpiresAt: Number(row.refresh_expires_at),
    createdAt: Number(row.created_at),
    lastUsedAt: (row.last_used_at as number | null) ?? null,
    revokedAt: (row.revoked_at as number | null) ?? null,
  };
}
