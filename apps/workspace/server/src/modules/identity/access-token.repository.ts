import type { OAuthClientRecord, OAuthGrantRecord, PersonalTokenRecord, RefreshFailure, SubjectToken } from "./access-tokens.js";
import type { PrincipalUser } from "./identity.types.js";

export interface TokenCredential {
  readonly kind: "pat" | "oauth";
  readonly id: string;
  readonly secret: string;
}

export interface GrantSecrets {
  readonly accessHash: string;
  readonly refreshHash: string;
}

export type RefreshOutcome =
  | { readonly ok: true; readonly grant: OAuthGrantRecord }
  | { readonly ok: false; readonly reason: RefreshFailure; readonly deletedSessions?: readonly string[] };

export interface ExchangedSession {
  readonly user: PrincipalUser;
  readonly subject: SubjectToken;
  readonly cookieValue: string;
  readonly ttlMs: number;
}

export interface AccessTokenRepository {
  insertPersonal(record: PersonalTokenRecord, tokenHash: string): Promise<void>;
  listPersonal(userId: string): Promise<PersonalTokenRecord[]>;
  /** Returns the sessions removed in the same commit, or null if the token was not revoked. */
  revokePersonal(userId: string, id: string, at: number): Promise<readonly string[] | null>;
  insertGrant(record: OAuthGrantRecord, secrets: GrantSecrets): Promise<void>;
  rotateGrant(input: {
    readonly id: string;
    readonly secret: string;
    readonly clientId: string;
    readonly resource?: string | undefined;
    readonly now: () => number;
    readonly next: GrantSecrets;
  }): Promise<RefreshOutcome>;
  revokeGrant(userId: string, id: string, at: number): Promise<readonly string[] | null>;
  revokeClientGrant(id: string, secret: string, refresh: boolean, clientId: string, at: number): Promise<readonly string[] | null>;
  verifySubject(token: TokenCredential, resource: string, at: number): Promise<SubjectToken | null>;
  /** Rechecks the token and principal, then inserts the linked session in a single transaction. */
  exchangeSubject(token: TokenCredential, resource: string, maxTtlMs: number, now: () => number): Promise<ExchangedSession | null>;
  /** Checks the registration cap and inserts the client atomically. */
  insertClient(client: OAuthClientRecord, limit: number | null): Promise<boolean>;
  getClient(id: string): Promise<OAuthClientRecord | null>;
}
