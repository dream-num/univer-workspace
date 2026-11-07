import type { WriteSource } from "./write-source.js";

export interface Principal {
  readonly user: User;
  readonly writeSource: WriteSource | null;
}

export interface User {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
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
  readonly user: User;
  readonly authenticationMethods: AuthenticationMethods;
}

export type SessionView =
  | {
      readonly authenticated: false;
      readonly githubOAuthEnabled: boolean;
      readonly googleOAuthEnabled: boolean;
      readonly discordOAuthEnabled: boolean;
      readonly passwordAuthEnabled: boolean;
      readonly emailAuthEnabled: boolean;
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
