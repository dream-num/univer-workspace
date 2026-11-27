import type { WriteSource } from "./write-source.js";

export interface Principal {
  readonly tokenIssued: boolean;
  readonly user: PrincipalUser;
  readonly writeSource: WriteSource | null;
}

export interface User {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

/** What kind of principal a User is. Only an agent can be claimed by a human. */
export type PrincipalKind =
  | { readonly kind: "human" }
  | { readonly kind: "agent"; readonly claimed: boolean };

export type PrincipalUser = User & PrincipalKind;

export type PrincipalCategory = "anonymous" | "agent_unclaimed" | "agent_claimed" | "human";

export interface AgentCreation {
  readonly label: string | undefined;
  /** The OAuth client's self-chosen name, from its registration or metadata document. Names the agent when no label is given. */
  readonly clientName?: string | null;
  /** Only the creation rate limit reads it; `source_rate_events` keeps its source bucket for about an hour. */
  readonly originIp: string | undefined;
  readonly ownerUserId?: string;
}

export interface CreatedAgent {
  readonly user: User;
  readonly expiresAt: number | null;
}

export interface AgentClaimCode {
  readonly code: string;
  /** The handoff page as a path on the Workspace origin. */
  readonly claimUrl: string;
  /** Seconds until the code stops working. */
  readonly expiresIn: number;
}

export interface AgentView extends User {
  readonly spaceId: string;
  readonly files: number;
  /** Unix epoch milliseconds, recorded at most once a day. */
  readonly lastActiveAt: number;
  readonly stopped: boolean;
}

export interface AgentSpace {
  readonly id: string;
  readonly type: "personal" | "team";
  readonly name: string;
  /** Files in the Space outside Trash. */
  readonly files: number;
}

/** What the handoff page shows of the agent its code names. */
export interface AgentHandoff {
  readonly agent: AgentView;
  /** The signed-in person already owns the agent. */
  readonly claimed: boolean;
  /** When the code stops working, as an ISO 8601 time. */
  readonly expiresAt: string;
  /** Every Space the agent owns, its Personal Space first. */
  readonly spaces: readonly AgentSpace[];
}

export interface AuthenticationMethods {
  readonly password: boolean;
  readonly email: string | null;
  readonly externalIdentities: readonly {
    readonly provider: ExternalIdentityProvider;
    readonly providerUsername: string;
  }[];
}

export interface AuthenticatedSession {
  readonly authenticated: true;
  readonly githubOAuthEnabled: boolean;
  readonly googleOAuthEnabled: boolean;
  readonly discordOAuthEnabled: boolean;
  readonly passwordAuthEnabled: boolean;
  readonly emailAuthEnabled: boolean;
  readonly trialDeployment: boolean;
  readonly user: PrincipalUser;
  readonly authenticationMethods: AuthenticationMethods;
  /** Present only when the operator granted the User the shared MCP executor. */
  readonly executorAccess?: true;
  /** Present only for an agent, and only on `GET /api/session`. */
  readonly budget?: AgentBudget;
}

/** What an agent has used of the limits every agent works within. */
export interface AgentBudget {
  readonly openWorktrees: { readonly used: number; readonly limit: number };
  readonly merges: { readonly used: number; readonly limit: number };
}

export type SessionView =
  | {
      readonly authenticated: false;
      readonly githubOAuthEnabled: boolean;
      readonly googleOAuthEnabled: boolean;
      readonly discordOAuthEnabled: boolean;
      readonly passwordAuthEnabled: boolean;
      readonly emailAuthEnabled: boolean;
      readonly guestAuthEnabled: boolean;
    }
  | AuthenticatedSession;

/** The MCP token a downstream login session was issued for; deleting the token deletes the session. */
export interface SessionIssuedFor {
  readonly kind: "pat" | "oauth";
  readonly id: string;
}

export interface IssueSessionOptions {
  readonly ttlMs?: number;
  readonly issuedFor?: SessionIssuedFor;
}

export interface IssuedSession {
  readonly cookieValue: string;
  readonly view: AuthenticatedSession;
}

export interface CliAuthorizationStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly expiresIn: number;
  readonly interval: number;
}

export type CliAuthorizationExchange =
  | { readonly status: "pending" }
  | { readonly status: "authorized"; readonly issuedSession: IssuedSession };

export interface PasswordRegistration {
  readonly username: unknown;
  readonly displayName: unknown;
  readonly password: unknown;
  /** Only sign-up attribution reads it; it is never stored. */
  readonly returnTo?: string | undefined;
}

export interface PasswordLogin {
  readonly username: unknown;
  readonly password: unknown;
}

export interface EmailLoginCodeRequest {
  readonly email: unknown;
}

export interface EmailLogin {
  readonly email: unknown;
  readonly code: unknown;
  /** Only sign-up attribution reads it; it is never stored. */
  readonly returnTo?: string | undefined;
}

export interface IssuedEmailLoginCode {
  /** Lifetime of the emailed code in seconds. */
  readonly expiresIn: number;
  /** Seconds before another code may be requested for the same address. */
  readonly resendAfter: number;
}

export interface DiscordBotLogin {
  readonly discordUserId: unknown;
  readonly username?: unknown;
  readonly displayName?: unknown;
  readonly avatarUrl?: unknown;
}

export interface PasswordChange {
  readonly currentPassword: unknown;
  readonly newPassword: unknown;
}

export interface UserProfilePatch {
  readonly username?: unknown;
  readonly displayName?: unknown;
  readonly avatarUrl?: unknown;
}

export type ExternalIdentityProvider = "github" | "google" | "discord";

export interface ExternalIdentity {
  readonly subject: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface ExternalOAuthProvider {
  authorizationUrl(input: {
    readonly state: string;
    readonly codeChallenge: string;
  }): string;
  exchangeCode(
    code: string,
    codeVerifier: string
  ): Promise<ExternalIdentity>;
}

export type GitHubOAuthProvider = ExternalOAuthProvider;
export type GoogleOAuthProvider = ExternalOAuthProvider;
export type DiscordOAuthProvider = ExternalOAuthProvider;
