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
  insertPersonal(record: PersonalTokenRecord, tokenHash: string): void;
  listPersonal(userId: string): PersonalTokenRecord[];
  /** Returns the sessions removed in the same commit, or null if the token was not revoked. */
  revokePersonal(userId: string, id: string, at: number): readonly string[] | null;
  insertGrant(record: OAuthGrantRecord, secrets: GrantSecrets): void;
  rotateGrant(input: {
    readonly id: string;
    readonly secret: string;
    readonly clientId: string;
    readonly resource: string;
    readonly now: () => number;
    readonly next: GrantSecrets;
  }): RefreshOutcome;
  revokeGrant(userId: string, id: string, at: number): readonly string[] | null;
  revokeClientGrant(id: string, secret: string, refresh: boolean, clientId: string, at: number): readonly string[] | null;
  verifySubject(token: TokenCredential, resource: string, at: number): SubjectToken | null;
  /** Rechecks the token and principal, then inserts the linked session in a single transaction. */
  exchangeSubject(token: TokenCredential, resource: string, maxTtlMs: number, now: () => number): Promise<ExchangedSession | null>;
  insertClient(client: OAuthClientRecord): void;
  getClient(id: string): OAuthClientRecord | null;
  countClients(): number;
}
