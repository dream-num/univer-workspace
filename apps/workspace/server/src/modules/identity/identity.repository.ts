import type {
  AuthenticationMethods,
  ExternalIdentityProvider,
  PrincipalUser,
  SessionIssuedFor,
  User,
} from "./identity.types.js";
import type { WriteSource } from "./write-source.js";

/** A banned agent is a User that may no longer authenticate. */
export type StoredPrincipal = PrincipalUser & { readonly banned: boolean };

export type StoredSession = StoredPrincipal & {
  readonly sessionId: string;
  readonly secretHash: string;
  readonly expiresAt: number;
  readonly writeSource: WriteSource | null;
  readonly tokenIssued: boolean;
};

export interface StoredCredential extends User {
  readonly passwordHash: string;
}

export interface NewPasswordUser {
  readonly user: User;
  readonly passwordHash: string;
  readonly personalSpace: {
    readonly id: string;
    readonly name: string;
  };
  readonly session: {
    readonly id: string;
    readonly secretHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly writeSource: WriteSource;
    readonly issuedFor?: SessionIssuedFor;
  };
  readonly createdAt: number;
}

export interface NewEmailUser {
  readonly user: User;
  readonly email: string;
  readonly personalSpace: NewPasswordUser["personalSpace"];
  readonly session: NewPasswordUser["session"];
  readonly createdAt: number;
}

export interface StoredEmailLoginCode {
  readonly id: string;
  readonly codeHash: string;
  readonly attempts: number;
}

export interface ExternalIdentityUser {
  readonly user: User;
  readonly providerUsername: string;
}

export type IdentityConflict = "username" | "email" | "externalIdentity";

export interface AgentBanResult {
  readonly status: "banned" | "not-agent";
  readonly username: string;
  readonly id: string;
}

export interface IdentityRepository {
  isIdentityConflict(error: unknown, field: IdentityConflict): boolean;
  banAgent(target: string, at: number): Promise<AgentBanResult | null>;
  createPasswordUser(input: NewPasswordUser): void;
  createExternalUser(input: {
    readonly provider: ExternalIdentityProvider;
    readonly user: User;
    readonly providerSubject: string;
    readonly providerUsername: string;
    readonly personalSpace: NewPasswordUser["personalSpace"];
    readonly session: NewPasswordUser["session"];
    readonly createdAt: number;
  }): void;
  createEmailUser(input: NewEmailUser): void;
  createAgentUser(input: {
    readonly user: User;
    readonly personalSpace: NewPasswordUser["personalSpace"];
    readonly originLabel: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): void;
  findExternalIdentity(
    provider: ExternalIdentityProvider,
    providerSubject: string
  ): ExternalIdentityUser | null;
  linkExternalIdentity(input: {
    readonly provider: ExternalIdentityProvider;
    readonly userId: string;
    readonly providerSubject: string;
    readonly providerUsername: string;
    readonly updatedAt: number;
  }): void;
  updateExternalUsername(
    provider: ExternalIdentityProvider,
    providerSubject: string,
    providerUsername: string,
    updatedAt: number
  ): void;
  removeExternalIdentity(
    userId: string,
    provider: ExternalIdentityProvider
  ): boolean;
  usernameExists(username: string): boolean;
  findUser(userId: string): User | null;
  findPrincipal(userId: string): StoredPrincipal | null;
  touchUnclaimedAgent(
    target: { readonly userId: string } | { readonly nodeId: string },
    at: number,
    staleBefore: number,
    expiresAt: number
  ): void;
  findUsers(userIds: readonly string[]): readonly User[];
  findCredential(username: string): StoredCredential | null;
  findCredentialByUserId(userId: string): StoredCredential | null;
  updatePasswordHash(
    userId: string,
    passwordHash: string,
    updatedAt: number
  ): void;
  createSession(
    userId: string,
    session: NewPasswordUser["session"]
  ): void;
  findSession(sessionId: string): StoredSession | null;
  authenticationMethods(userId: string): AuthenticationMethods;
  findUserByEmail(email: string): User | null;
  createEmailLoginCode(input: {
    readonly id: string;
    readonly email: string;
    readonly codeHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): void;
  findEmailLoginCode(
    email: string,
    now: number
  ): StoredEmailLoginCode | null;
  incrementEmailLoginCodeAttempts(id: string): void;
  consumeEmailLoginCode(id: string, consumedAt: number): boolean;
  consumeOtherEmailLoginCodes(
    email: string,
    keepId: string,
    consumedAt: number
  ): void;
  deleteEmailLoginCode(id: string): void;
  latestEmailLoginCodeCreatedAt(email: string): number | null;
  countEmailLoginCodesSince(email: string, since: number): number;
  deleteEmailLoginCodesBefore(cutoff: number): void;
  updateUser(user: User, updatedAt: number): void;
  deleteSession(sessionId: string): void;
  deleteExpiredSessions(now: number): string[];
}
