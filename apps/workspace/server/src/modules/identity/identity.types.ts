export interface User {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface AuthenticationMethods {
  readonly password: boolean;
  readonly externalIdentities: readonly {
    readonly provider: ExternalIdentityProvider;
    readonly providerUsername: string;
  }[];
}

export interface AuthenticatedSession {
  readonly authenticated: true;
  readonly githubOAuthEnabled: boolean;
  readonly discordOAuthEnabled: boolean;
  readonly user: User;
  readonly authenticationMethods: AuthenticationMethods;
}

export type SessionView =
  | {
      readonly authenticated: false;
      readonly githubOAuthEnabled: boolean;
      readonly discordOAuthEnabled: boolean;
    }
  | AuthenticatedSession;

export interface IssuedSession {
  readonly cookieValue: string;
  readonly view: AuthenticatedSession;
}

export interface PasswordRegistration {
  readonly username: unknown;
  readonly displayName: unknown;
  readonly password: unknown;
}

export interface PasswordLogin {
  readonly username: unknown;
  readonly password: unknown;
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

export type ExternalIdentityProvider = "github" | "discord";

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
export type DiscordOAuthProvider = ExternalOAuthProvider;
