import type { PostgresDatabase } from "../connection.js";
import type {
  AccessTokenRepository,
  ExchangedSession,
  GrantSecrets,
  RefreshOutcome,
  TokenCredential,
} from "../../../modules/identity/access-token.repository.js";
import {
  ACCESS_TOKEN_TTL_MS,
  MCP_SCOPES,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  type McpScope,
  type OAuthClientRecord,
  type OAuthGrantRecord,
  type PersonalTokenRecord,
  type SubjectToken,
} from "../../../modules/identity/access-tokens.js";
import { authenticateStoredPrincipal } from "../../../modules/identity/agent-activity.js";
import { createSessionToken, hashSessionSecret, secretMatches } from "../../../modules/identity/session-token.js";
import { findPrincipal, insertSession, touchUnclaimedAgent } from "./identity.repository.js";

type Row = Record<string, unknown>;

export class PostgresAccessTokenRepository implements AccessTokenRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async insertPersonal(token: PersonalTokenRecord, tokenHash: string): Promise<void> {
    await this.database.prepare(
      `INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(token.id, token.userId, token.name, tokenHash, token.scopes.join(" "), token.createdAt, token.expiresAt);
  }

  async listPersonal(userId: string): Promise<PersonalTokenRecord[]> {
    return (await this.database.prepare(
      "SELECT * FROM personal_access_tokens WHERE user_id = ? ORDER BY created_at DESC, id"
    ).all(userId)).map(toPersonalToken);
  }

  async revokePersonal(userId: string, id: string, at: number): Promise<readonly string[] | null> {
    return await this.database.transaction(async (db) => {
      const revoked = await db.prepare(
        "UPDATE personal_access_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
      ).run(at, id, userId);
      return revoked.changes > 0 ? await this.deleteSessions("issued_for_pat_id", id) : null;
    });
  }

  async insertGrant(grant: OAuthGrantRecord, secrets: GrantSecrets): Promise<void> {
    await this.database.transaction(async (db) => {
      await db.prepare(
        `INSERT INTO oauth_grants
          (id, user_id, client_id, scopes, resource, access_token_hash, access_expires_at,
           refresh_token_hash, refresh_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        grant.id, grant.userId, grant.clientId, grant.scopes.join(" "), grant.resource, secrets.accessHash,
        grant.accessExpiresAt, secrets.refreshHash, grant.refreshExpiresAt, grant.createdAt,
      );
      await db.prepare("UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?").run(grant.createdAt, grant.clientId);
    });
  }

  async rotateGrant(input: Parameters<AccessTokenRepository["rotateGrant"]>[0]): Promise<RefreshOutcome> {
    const { id, secret, next } = input;
    return await this.database.transaction(async (db): Promise<RefreshOutcome> => {
      const row = await this.grantRow(id);
      if (!row) return { ok: false, reason: "invalid" };
      const at = input.now();
      const current = secretMatches(secret, String(row.refresh_token_hash));
      const retired = current ? undefined : await db.prepare(
        "SELECT retired_at FROM oauth_refresh_history WHERE refresh_token_hash = ? AND grant_id = ?"
      ).get(hashSessionSecret(secret), id);
      if (!current && !retired) return { ok: false, reason: "invalid" };
      if (row.revoked_at !== null) return { ok: false, reason: "revoked" };
      if (Number(row.refresh_expires_at) <= at) return { ok: false, reason: "expired" };
      if (retired) {
        if (at - Number(retired.retired_at) < REFRESH_REUSE_GRACE_MS) return { ok: false, reason: "retired" };
        return { ok: false, reason: "reused", deletedSessions: await this.revokeGrantNow(id, at) ?? [] };
      }
      if (row.client_id !== input.clientId) return { ok: false, reason: "client_mismatch" };
      if (row.resource !== input.resource) return { ok: false, reason: "resource_mismatch" };
      await db.prepare("INSERT INTO oauth_refresh_history (refresh_token_hash, grant_id, retired_at) VALUES (?, ?, ?)")
        .run(String(row.refresh_token_hash), id, at);
      await db.prepare("DELETE FROM oauth_refresh_history WHERE grant_id = ? AND retired_at < ?")
        .run(id, at - REFRESH_TOKEN_TTL_MS);
      await db.prepare(
        `UPDATE oauth_grants
         SET access_token_hash = ?, access_expires_at = ?, refresh_token_hash = ?, refresh_expires_at = ?, last_used_at = ?
         WHERE id = ?`
      ).run(next.accessHash, at + ACCESS_TOKEN_TTL_MS, next.refreshHash, at + REFRESH_TOKEN_TTL_MS, at, id);
      return { ok: true, grant: toGrant((await this.grantRow(id))!) };
    });
  }

  async revokeGrant(userId: string, id: string, at: number): Promise<readonly string[] | null> {
    return await this.database.transaction(async () => await this.revokeGrantNow(id, at, userId));
  }

  async revokeClientGrant(id: string, secret: string, refresh: boolean, clientId: string, at: number): Promise<readonly string[] | null> {
    return await this.database.transaction(async () => {
      const row = await this.grantRow(id);
      if (!row || row.client_id !== clientId ||
          !secretMatches(secret, String(refresh ? row.refresh_token_hash : row.access_token_hash))) return null;
      return await this.revokeGrantNow(id, at);
    });
  }

  async verifySubject(token: TokenCredential, resource: string, at: number): Promise<SubjectToken | null> {
    return this.database.transaction(() => this.verifySubjectNow(token, resource, at));
  }

  private async verifySubjectNow(token: TokenCredential, resource: string, at: number): Promise<SubjectToken | null> {
    const db = this.database;
    if (token.kind === "pat") {
      const row = await db.prepare("SELECT * FROM personal_access_tokens WHERE id = ?").get(token.id);
      if (!row || !secretMatches(token.secret, String(row.token_hash)) || row.revoked_at !== null ||
          (row.expires_at !== null && Number(row.expires_at) <= at)) return null;
      await db.prepare("UPDATE personal_access_tokens SET last_used_at = ? WHERE id = ?").run(at, token.id);
      return {
        kind: "pat", id: token.id, userId: String(row.user_id), scopes: toScopes(row.scopes),
        expiresAt: row.expires_at === null ? null : Number(row.expires_at),
      };
    }
    const row = await this.grantRow(token.id);
    if (!row || !secretMatches(token.secret, String(row.access_token_hash)) || row.revoked_at !== null ||
        Number(row.access_expires_at) <= at || row.resource !== resource) return null;
    await db.prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?").run(at, token.id);
    return {
      kind: "oauth", id: token.id, userId: String(row.user_id), scopes: toScopes(row.scopes),
      expiresAt: Number(row.access_expires_at), clientId: String(row.client_id),
    };
  }

  async exchangeSubject(token: TokenCredential, resource: string, maxTtlMs: number, now: () => number): Promise<ExchangedSession | null> {
    return await this.database.transaction(async (db) => {
      const at = now();
      const subject = await this.verifySubjectNow(token, resource, at);
      if (!subject) return null;
      const authenticated = authenticateStoredPrincipal(await findPrincipal(db, subject.userId), at);
      if (!authenticated) return null;
      const { principal, activity } = authenticated;
      if (activity) await touchUnclaimedAgent(db, { userId: principal.id }, at, activity.staleBefore, activity.expiresAt);
      const expiresAt = Math.min(at + maxTtlMs, subject.expiresAt ?? Infinity);
      const ttlMs = expiresAt - at;
      if (ttlMs < 1000) return null;
      const session = createSessionToken(at, expiresAt, "agent", { kind: subject.kind, id: subject.id });
      await insertSession(db, principal.id, session.stored);
      const { banned: _banned, ...user } = principal;
      return { user, subject, cookieValue: session.cookieValue, ttlMs };
    });
  }

  async insertClient(client: OAuthClientRecord, limit: number | null): Promise<boolean> {
    return this.database.transaction(async (db) => {
      // Take the lock before the first snapshot so a waiter counts the committed registration.
      if (limit !== null) await db.query("LOCK TABLE oauth_clients IN SHARE ROW EXCLUSIVE MODE", []);

      const result = await db.prepare(`
        INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at)
        SELECT $clientId, $clientName, $redirectUris, $createdAt
        WHERE $limit::bigint IS NULL OR (SELECT COUNT(*) FROM oauth_clients) < $limit
      `).run({ clientId: client.clientId, clientName: client.clientName, redirectUris: JSON.stringify(client.redirectUris),
        createdAt: client.createdAt, limit });
      return result.changes > 0;
    });
  }

  async getClient(clientId: string): Promise<OAuthClientRecord | null> {
    const row = await this.database.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId);
    return row ? {
      clientId: String(row.client_id), clientName: row.client_name as string | null,
      redirectUris: JSON.parse(String(row.redirect_uris)) as string[],
      createdAt: Number(row.created_at), lastUsedAt: row.last_used_at as number | null,
    } : null;
  }

  private async grantRow(id: string) {
    return await this.database.prepare("SELECT * FROM oauth_grants WHERE id = ?").get(id);
  }

  private async revokeGrantNow(id: string, at: number, userId?: string): Promise<readonly string[] | null> {
    const revoked = await this.database.prepare(
      "UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND (?::text IS NULL OR user_id = ?)"
    ).run(at, id, userId ?? null, userId ?? null);
    return revoked.changes > 0 ? await this.deleteSessions("issued_for_grant_id", id) : null;
  }

  private async deleteSessions(column: "issued_for_pat_id" | "issued_for_grant_id", id: string): Promise<string[]> {
    return (await this.database.prepare(`DELETE FROM login_sessions WHERE ${column} = ? RETURNING id`).all(id))
      .map((row) => String(row.id));
  }
}

function toScopes(value: unknown): McpScope[] {
  return MCP_SCOPES.filter((scope) => String(value).split(" ").includes(scope));
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
