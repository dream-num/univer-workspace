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
}

/** An address gets no new code while it has one created after `recentSince`, or `windowLimit` created after `windowSince`. */
export interface EmailLoginCodeLimits {
  readonly recentSince: number;
  readonly windowSince: number;
  readonly windowLimit: number;
}

export type EmailLoginCodeCreation = "created" | "sent-recently" | "too-many";

export interface ExternalIdentityUser {
  readonly user: User;
  readonly providerUsername: string;
}

export type IdentityConflict = "username" | "email" | "externalIdentity";

export interface NamedUser {
  readonly id: string;
  readonly username: string;
  readonly kind: "human" | "agent";
}

export interface StoredAgent {
  readonly user: User;
  readonly spaceId: string;
  readonly ownerUserId: string | null;
  readonly lastActiveAt: number;
  readonly banned: boolean;
  readonly files: number;
}

export interface ExecutorAccessEntry extends NamedUser {
  readonly grantedAt: number;
}

export interface IdentityRepository {
  isIdentityConflict(error: unknown, field: IdentityConflict): Promise<boolean>;
  /** The User whose ID and the User whose username equal `target` ignoring ASCII case; the same User when both match. */
  findUsersByIdOrUsername(target: string): Promise<readonly NamedUser[]>;
  banAgent(agentUserId: string, at: number): Promise<void>;
  findAgents(filter: { readonly userId: string } | { readonly ownerUserId: string }): Promise<readonly StoredAgent[]>;
  claimAgent(agentUserId: string, ownerUserId: string, at: number): Promise<boolean>;
  banClaimedAgent(ownerUserId: string, agentUserId: string, at: number): Promise<boolean>;
  /** Grants or revokes the shared MCP executor; false when the User already had, or already lacked, it. */
  setExecutorAccess(userId: string, granted: boolean, at: number): Promise<boolean>;
  hasExecutorAccess(userId: string): Promise<boolean>;
  listExecutorAccess(): Promise<readonly ExecutorAccessEntry[]>;
  createPasswordUser(input: NewPasswordUser): Promise<void>;
  createExternalUser(input: {
    readonly provider: ExternalIdentityProvider;
    readonly user: User;
    readonly providerSubject: string;
    readonly providerUsername: string;
    readonly personalSpace: NewPasswordUser["personalSpace"];
    readonly session: NewPasswordUser["session"];
    readonly createdAt: number;
  }): Promise<void>;
  createEmailUser(input: NewEmailUser): Promise<void>;
  createAgentUser(input: {
    readonly user: User;
    readonly personalSpace: NewPasswordUser["personalSpace"];
    readonly originLabel: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): Promise<void>;
  findExternalIdentity(
    provider: ExternalIdentityProvider,
    providerSubject: string
  ): Promise<ExternalIdentityUser | null>;
  linkExternalIdentity(input: {
    readonly provider: ExternalIdentityProvider;
    readonly userId: string;
    readonly providerSubject: string;
    readonly providerUsername: string;
    readonly updatedAt: number;
  }): Promise<void>;
  updateExternalUsername(
    provider: ExternalIdentityProvider,
    providerSubject: string,
    providerUsername: string,
    updatedAt: number
  ): Promise<void>;
  /** Returns false if removing this identity would leave the User without a sign-in method. */
  removeExternalIdentity(userId: string, provider: ExternalIdentityProvider, passwordAuthEnabled: boolean): Promise<boolean>;
  usernameExists(username: string): Promise<boolean>;
  findUser(userId: string): Promise<User | null>;
  findPrincipal(userId: string): Promise<StoredPrincipal | null>;
  touchAgent(
    target: { readonly userId: string } | { readonly nodeId: string },
    at: number,
    staleBefore: number,
    expiresAt: number
  ): Promise<void>;
  findUsers(userIds: readonly string[]): Promise<readonly User[]>;
  findCredential(username: string): Promise<StoredCredential | null>;
  findCredentialByUserId(userId: string): Promise<StoredCredential | null>;
  /** Also deletes, in the same transaction, the User's sessions that renew on use, except `keepSessionId`, and returns their ids. */
  updatePasswordHash(
    userId: string,
    passwordHash: string,
    updatedAt: number,
    keepSessionId: string
  ): Promise<string[]>;
  createSession(
    userId: string,
    session: NewPasswordUser["session"]
  ): Promise<void>;
  findSession(sessionId: string): Promise<StoredSession | null>;
  authenticationMethods(userId: string): Promise<AuthenticationMethods>;
  findUserByEmail(email: string): Promise<User | null>;
  /** Checks the limits and inserts the code in one atomic step per address. */
  createEmailLoginCode(input: {
    readonly id: string;
    readonly email: string;
    readonly codeHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }, limits: EmailLoginCodeLimits): Promise<EmailLoginCodeCreation>;
  findEmailLoginCode(
    email: string,
    now: number
  ): Promise<StoredEmailLoginCode | null>;
  reserveEmailLoginCodeAttempt(id: string, maxAttempts: number): Promise<boolean>;
  consumeEmailLoginCode(id: string, consumedAt: number): Promise<boolean>;
  consumeOtherEmailLoginCodes(
    email: string,
    keepId: string,
    consumedAt: number
  ): Promise<void>;
  deleteEmailLoginCode(id: string): Promise<void>;
  deleteEmailLoginCodesBefore(cutoff: number): Promise<void>;
  /** Updates supplied fields only. A provider may fill fields only while their observed values still match. */
  updateUser(userId: string, patch: Partial<Omit<User, "id">>, updatedAt: number, expected?: User): Promise<User>;
  renewSession(sessionId: string, expiresAt: number): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  deleteExpiredSessions(now: number): Promise<string[]>;
}
