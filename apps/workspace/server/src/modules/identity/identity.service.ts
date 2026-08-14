import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { ApplicationError } from "../../middleware/errors.js";
import { IdentityRepository } from "./identity.repository.js";
import type {
  AuthenticatedSession,
  IssuedSession,
  PasswordChange,
  PasswordLogin,
  PasswordRegistration,
  SessionView,
  User,
  UserProfilePatch,
  DiscordOAuthProvider,
  DiscordBotLogin,
  ExternalIdentity,
  ExternalIdentityProvider,
  ExternalOAuthProvider,
  GitHubOAuthProvider,
} from "./identity.types.js";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "workspace_session";
const GITHUB_OAUTH_COOKIE_NAME = "workspace_github_oauth";
const DISCORD_OAUTH_COOKIE_NAME = "workspace_discord_oauth";

export interface IdentityModule {
  readonly cookieName: string;
  readonly sessionTtlMs: number;
  readonly githubOAuthCookieName: string;
  readonly discordOAuthCookieName: string;
  registerWithPassword(input: PasswordRegistration): Promise<IssuedSession>;
  loginWithPassword(input: PasswordLogin): Promise<IssuedSession>;
  loginWithDiscordBot(input: DiscordBotLogin): IssuedSession;
  changePassword(
    cookieHeader: string | undefined,
    input: PasswordChange
  ): Promise<void>;
  getSession(cookieHeader: string | undefined): SessionView;
  requireSession(cookieHeader: string | undefined): AuthenticatedSession;
  logout(cookieHeader: string | undefined): void;
  updateCurrentUser(
    cookieHeader: string | undefined,
    patch: UserProfilePatch
  ): User;
  startGitHubOAuth(input: {
    readonly intent: "login" | "link";
    readonly returnTo: unknown;
    readonly cookieHeader: string | undefined;
  }): {
    readonly authorizationUrl: string;
    readonly cookieValue: string;
  };
  finishGitHubOAuth(input: {
    readonly code: unknown;
    readonly state: unknown;
    readonly providerError: unknown;
    readonly oauthCookieHeader: string | undefined;
    readonly sessionCookieHeader: string | undefined;
  }): Promise<{
    readonly returnTo: string;
    readonly issuedSession: IssuedSession | null;
  }>;
  unlinkGitHub(cookieHeader: string | undefined): AuthenticatedSession;
  startDiscordOAuth(input: {
    readonly intent: "login" | "link";
    readonly returnTo: unknown;
    readonly cookieHeader: string | undefined;
  }): {
    readonly authorizationUrl: string;
    readonly cookieValue: string;
  };
  finishDiscordOAuth(input: {
    readonly code: unknown;
    readonly state: unknown;
    readonly providerError: unknown;
    readonly oauthCookieHeader: string | undefined;
    readonly sessionCookieHeader: string | undefined;
  }): Promise<{
    readonly returnTo: string;
    readonly issuedSession: IssuedSession | null;
  }>;
  unlinkDiscord(cookieHeader: string | undefined): AuthenticatedSession;
}

export function createIdentityModule(options: {
  readonly repository: IdentityRepository;
  readonly sessionTtlMs: number;
  readonly now?: () => number;
  readonly githubOAuthProvider?: GitHubOAuthProvider | null;
  readonly discordOAuthProvider?: DiscordOAuthProvider | null;
  readonly oauthStateSecret?: string;
}): IdentityModule {
  const now = options.now ?? Date.now;
  const repository = options.repository;
  const githubOAuthProvider = options.githubOAuthProvider ?? null;
  const discordOAuthProvider = options.discordOAuthProvider ?? null;
  const oauthStateSecret = options.oauthStateSecret ?? "";
  const githubOAuthEnabled = Boolean(
    githubOAuthProvider && oauthStateSecret
  );
  const discordOAuthEnabled = Boolean(
    discordOAuthProvider && oauthStateSecret
  );
  repository.deleteExpiredSessions(now());

  function authenticatedSession(user: User): AuthenticatedSession {
    return {
      authenticated: true,
      githubOAuthEnabled,
      discordOAuthEnabled,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      authenticationMethods: repository.authenticationMethods(user.id),
    };
  }

  function getSession(cookieHeader: string | undefined): SessionView {
    const token = readSessionToken(cookieHeader);
    if (!token)
      return { authenticated: false, githubOAuthEnabled, discordOAuthEnabled };
    const stored = repository.findSession(token.id);
    if (!stored)
      return { authenticated: false, githubOAuthEnabled, discordOAuthEnabled };
    if (stored.expiresAt <= now()) {
      repository.deleteSession(stored.sessionId);
      return { authenticated: false, githubOAuthEnabled, discordOAuthEnabled };
    }
    if (!secretMatches(token.secret, stored.secretHash)) {
      return { authenticated: false, githubOAuthEnabled, discordOAuthEnabled };
    }
    return authenticatedSession(stored);
  }

  function requireSession(
    cookieHeader: string | undefined
  ): AuthenticatedSession {
    const session = getSession(cookieHeader);
    if (!session.authenticated) {
      throw new ApplicationError(
        "UNAUTHENTICATED",
        401,
        "Authentication is required."
      );
    }
    return session;
  }

  function issueSession(user: User): IssuedSession {
    const createdAt = now();
    const issued = createSessionToken(
      createdAt,
      createdAt + options.sessionTtlMs
    );
    repository.createSession(user.id, issued.stored);
    return {
      cookieValue: issued.cookieValue,
      view: authenticatedSession(user),
    };
  }

  return {
    cookieName: COOKIE_NAME,
    githubOAuthCookieName: GITHUB_OAUTH_COOKIE_NAME,
    discordOAuthCookieName: DISCORD_OAUTH_COOKIE_NAME,
    sessionTtlMs: options.sessionTtlMs,

    async registerWithPassword(input) {
      const username = validUsername(input.username);
      const displayName = validDisplayName(input.displayName);
      const password = validPassword(input.password);
      const createdAt = now();
      const user: User = {
        id: randomUUID(),
        username,
        displayName,
        avatarUrl: null,
      };
      const issued = createSessionToken(
        createdAt,
        createdAt + options.sessionTtlMs
      );

      try {
        repository.createPasswordUser({
          user,
          passwordHash: await hashPassword(password),
          personalSpace: {
            id: randomUUID(),
            name: `${displayName} 的个人空间`,
          },
          session: issued.stored,
          createdAt,
        });
      } catch (error) {
        if (isUniqueConstraint(error, "users.username")) {
          throw usernameTaken();
        }
        throw error;
      }

      return {
        cookieValue: issued.cookieValue,
        view: authenticatedSession(user),
      };
    },

    async loginWithPassword(input) {
      const username = validUsername(input.username);
      const password = validPassword(input.password);
      const credential = repository.findCredential(username);
      if (
        !credential ||
        !(await verifyPassword(password, credential.passwordHash))
      ) {
        throw new ApplicationError(
          "INVALID_CREDENTIALS",
          401,
          "Username or password is invalid."
        );
      }

      return issueSession(credential);
    },

    loginWithDiscordBot(input) {
      const discordUserId = validDiscordUserId(input.discordUserId);
      const suppliedUsername =
        input.username === undefined
          ? undefined
          : validUsername(input.username);
      const existing = repository.findExternalIdentity(
        "discord",
        discordUserId
      );
      if (existing) {
        if (
          suppliedUsername !== undefined &&
          suppliedUsername !== existing.providerUsername
        ) {
          repository.updateExternalUsername(
            "discord",
            discordUserId,
            suppliedUsername,
            now()
          );
        }
        return issueSession(existing.user);
      }

      const providerUsername =
        suppliedUsername ?? `discord-${discordUserId}`;
      const displayName =
        input.displayName === undefined
          ? providerUsername
          : validDisplayName(input.displayName);
      const avatarUrl =
        input.avatarUrl === undefined
          ? null
          : validAvatarUrl(input.avatarUrl);
      const createdAt = now();
      const user: User = {
        id: randomUUID(),
        username: availableExternalUsername(
          providerUsername,
          discordUserId,
          "discord",
          repository
        ),
        displayName,
        avatarUrl,
      };
      const token = createSessionToken(
        createdAt,
        createdAt + options.sessionTtlMs
      );
      try {
        repository.createExternalUser({
          provider: "discord",
          user,
          providerSubject: discordUserId,
          providerUsername,
          personalSpace: {
            id: randomUUID(),
            name: `${displayName} 的个人空间`,
          },
          session: token.stored,
          createdAt,
        });
      } catch (error) {
        if (isUniqueConstraint(error, "external_identities")) {
          const concurrent = repository.findExternalIdentity(
            "discord",
            discordUserId
          );
          if (concurrent) return issueSession(concurrent.user);
        }
        throw error;
      }
      return {
        cookieValue: token.cookieValue,
        view: authenticatedSession(user),
      };
    },

    async changePassword(cookieHeader, input) {
      const session = requireSession(cookieHeader);
      const currentPassword = validPassword(
        input.currentPassword,
        "currentPassword"
      );
      const newPassword = validPassword(input.newPassword, "newPassword");
      const credential = repository.findCredentialByUserId(
        session.user.id
      );
      if (!credential) {
        throw new ApplicationError(
          "PASSWORD_NOT_CONFIGURED",
          409,
          "This User does not have a password credential."
        );
      }
      if (
        !(await verifyPassword(
          currentPassword,
          credential.passwordHash
        ))
      ) {
        throw new ApplicationError(
          "INVALID_CURRENT_PASSWORD",
          400,
          "Current password is invalid.",
          "currentPassword"
        );
      }
      repository.updatePasswordHash(
        session.user.id,
        await hashPassword(newPassword),
        now()
      );
    },

    getSession,
    requireSession,

    logout(cookieHeader) {
      const token = readSessionToken(cookieHeader);
      if (!token) return;
      const stored = repository.findSession(token.id);
      if (stored && secretMatches(token.secret, stored.secretHash)) {
        repository.deleteSession(token.id);
      }
    },

    updateCurrentUser(cookieHeader, patch) {
      const session = requireSession(cookieHeader);
      if (
        patch.username === undefined &&
        patch.displayName === undefined &&
        patch.avatarUrl === undefined
      ) {
        throw invalidInput(
          "At least one profile field is required.",
          undefined
        );
      }

      const user: User = {
        id: session.user.id,
        username:
          patch.username === undefined
            ? session.user.username
            : validUsername(patch.username),
        displayName:
          patch.displayName === undefined
            ? session.user.displayName
            : validDisplayName(patch.displayName),
        avatarUrl:
          patch.avatarUrl === undefined
            ? session.user.avatarUrl
            : validAvatarUrl(patch.avatarUrl),
      };
      try {
        repository.updateUser(user, now());
      } catch (error) {
        if (isUniqueConstraint(error, "users.username")) {
          throw usernameTaken();
        }
        throw error;
      }
      return user;
    },

    startGitHubOAuth(input) {
      return startExternalOAuth("github", githubOAuthProvider, input);
    },

    startDiscordOAuth(input) {
      return startExternalOAuth("discord", discordOAuthProvider, input);
    },

    async finishGitHubOAuth(input) {
      return finishExternalOAuth("github", githubOAuthProvider, input);
    },

    async finishDiscordOAuth(input) {
      return finishExternalOAuth("discord", discordOAuthProvider, input);
    },

    unlinkGitHub(cookieHeader) {
      return unlinkExternalIdentity("github", cookieHeader);
    },

    unlinkDiscord(cookieHeader) {
      return unlinkExternalIdentity("discord", cookieHeader);
    },
  };

  function startExternalOAuth(
    provider: ExternalIdentityProvider,
    oauthProvider: ExternalOAuthProvider | null,
    input: {
      readonly intent: "login" | "link";
      readonly returnTo: unknown;
      readonly cookieHeader: string | undefined;
    }
  ) {
    if (!oauthProvider || !oauthStateSecret) {
      throw oauthUnavailable(provider);
    }
    const linkedUserId =
      input.intent === "link"
        ? requireSession(input.cookieHeader).user.id
        : null;
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const returnTo = validReturnTo(input.returnTo);
    const cookieValue = signOAuthState(
      {
        state,
        verifier,
        provider,
        intent: input.intent,
        linkedUserId,
        returnTo,
        expiresAt: now() + 10 * 60 * 1000,
      },
      oauthStateSecret
    );
    return {
      authorizationUrl: oauthProvider.authorizationUrl({
        state,
        codeChallenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      }),
      cookieValue,
    };
  }

  async function finishExternalOAuth(
    provider: ExternalIdentityProvider,
    oauthProvider: ExternalOAuthProvider | null,
    input: {
      readonly code: unknown;
      readonly state: unknown;
      readonly providerError: unknown;
      readonly oauthCookieHeader: string | undefined;
      readonly sessionCookieHeader: string | undefined;
    }
  ) {
    if (!oauthProvider || !oauthStateSecret) {
      throw oauthUnavailable(provider);
    }
    const providerName = providerDisplayName(provider);
    if (typeof input.providerError === "string" && input.providerError) {
      throw new ApplicationError(
        oauthFailedCode(provider),
        400,
        `${providerName} authorization was cancelled.`
      );
    }
    const state = requiredOAuthText(input.state, "state", provider);
    const code = requiredOAuthText(input.code, "code", provider);
    const signed = readCookie(
      input.oauthCookieHeader,
      oauthCookieName(provider)
    );
    const oauth = signed
      ? verifyOAuthState(signed, oauthStateSecret)
      : null;
    if (
      !oauth ||
      oauth.provider !== provider ||
      oauth.expiresAt <= now() ||
      oauth.state !== state
    ) {
      throw new ApplicationError(
        oauthFailedCode(provider),
        400,
        `${providerName} OAuth state is invalid or expired.`
      );
    }
    const identity = await oauthProvider.exchangeCode(
      code,
      oauth.verifier
    );
    const existing = repository.findExternalIdentity(
      provider,
      identity.subject
    );
    if (oauth.intent === "link") {
      const session = requireSession(input.sessionCookieHeader);
      if (
        !oauth.linkedUserId ||
        oauth.linkedUserId !== session.user.id
      ) {
        throw new ApplicationError(
          oauthFailedCode(provider),
          400,
          `The ${providerName} link session does not match.`
        );
      }
      if (existing && existing.user.id !== session.user.id) {
        throw new ApplicationError(
          "CONFLICT",
          409,
          `This ${providerName} account is already linked to another user.`
        );
      }
      try {
        repository.linkExternalIdentity({
          provider,
          userId: session.user.id,
          providerSubject: identity.subject,
          providerUsername: identity.username,
          updatedAt: now(),
        });
      } catch (error) {
        if (isUniqueConstraint(error, "external_identities")) {
          throw new ApplicationError(
            "CONFLICT",
            409,
            `This ${providerName} account is already linked to another user.`
          );
        }
        throw error;
      }
      return { returnTo: oauth.returnTo, issuedSession: null };
    }

    if (existing) {
      repository.updateExternalUsername(
        provider,
        identity.subject,
        identity.username,
        now()
      );
      const user =
        provider === "discord"
          ? completeDiscordPlaceholderProfile(existing.user, identity)
          : existing.user;
      return {
        returnTo: oauth.returnTo,
        issuedSession: issueSession(user),
      };
    }

    const createdAt = now();
    const user: User = {
      id: randomUUID(),
      username: availableExternalUsername(
        identity.username,
        identity.subject,
        provider,
        repository
      ),
      displayName: validDisplayName(identity.displayName),
      avatarUrl: validAvatarUrl(identity.avatarUrl),
    };
    const token = createSessionToken(
      createdAt,
      createdAt + options.sessionTtlMs
    );
    repository.createExternalUser({
      provider,
      user,
      providerSubject: identity.subject,
      providerUsername: identity.username,
      personalSpace: {
        id: randomUUID(),
        name: `${user.displayName} 的个人空间`,
      },
      session: token.stored,
      createdAt,
    });
    return {
      returnTo: oauth.returnTo,
      issuedSession: {
        cookieValue: token.cookieValue,
        view: authenticatedSession(user),
      },
    };
  }

  function unlinkExternalIdentity(
    provider: ExternalIdentityProvider,
    cookieHeader: string | undefined
  ) {
    const session = requireSession(cookieHeader);
    const methods = repository.authenticationMethods(session.user.id);
    const hasProvider = methods.externalIdentities.some(
      (identity) => identity.provider === provider
    );
    if (
      hasProvider &&
      !methods.password &&
      methods.externalIdentities.length === 1
    ) {
      throw new ApplicationError(
        "CONFLICT",
        409,
        `${providerDisplayName(provider)} cannot be unlinked because it is the last authentication method.`
      );
    }
    repository.removeExternalIdentity(session.user.id, provider);
    const user = repository.findUser(session.user.id);
    if (!user) {
      throw new Error("Authenticated user is missing.");
    }
    return authenticatedSession(user);
  }

  function completeDiscordPlaceholderProfile(
    user: User,
    identity: ExternalIdentity
  ): User {
    const placeholder = `discord-${identity.subject}`;
    const usernameIsPlaceholder = user.username === placeholder;
    const displayNameIsPlaceholder = user.displayName === placeholder;
    const avatarIsMissing = user.avatarUrl === null && identity.avatarUrl !== null;
    if (
      !usernameIsPlaceholder &&
      !displayNameIsPlaceholder &&
      !avatarIsMissing
    ) {
      return user;
    }
    const completed: User = {
      id: user.id,
      username: usernameIsPlaceholder
        ? availableExternalUsername(
            identity.username,
            identity.subject,
            "discord",
            repository
          )
        : user.username,
      displayName: displayNameIsPlaceholder
        ? validDisplayName(identity.displayName)
        : user.displayName,
      avatarUrl: avatarIsMissing ? identity.avatarUrl : user.avatarUrl,
    };
    repository.updateUser(completed, now());
    return completed;
  }
}

interface OAuthState {
  readonly state: string;
  readonly verifier: string;
  readonly provider: ExternalIdentityProvider;
  readonly intent: "login" | "link";
  readonly linkedUserId: string | null;
  readonly returnTo: string;
  readonly expiresAt: number;
}

function signOAuthState(value: OAuthState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyOAuthState(
  value: string,
  secret: string
): OAuthState | null {
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const actual = Buffer.from(value.slice(separator + 1), "base64url");
  const expected = Buffer.from(
    createHmac("sha256", secret).update(payload).digest("base64url"),
    "base64url"
  );
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<OAuthState>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      (parsed.provider !== "github" && parsed.provider !== "discord") ||
      (parsed.intent !== "login" && parsed.intent !== "link") ||
      (parsed.linkedUserId !== null &&
        typeof parsed.linkedUserId !== "string") ||
      typeof parsed.returnTo !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed as OAuthState;
  } catch {
    return null;
  }
}

function validReturnTo(value: unknown): string {
  if (value === undefined) return "/";
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    throw invalidInput("returnTo must be a local application path.", "returnTo");
  }
  return value;
}

function requiredOAuthText(
  value: unknown,
  field: string,
  provider: ExternalIdentityProvider
): string {
  if (typeof value !== "string" || !value) {
    throw new ApplicationError(
      oauthFailedCode(provider),
      400,
      `${field} is required.`
    );
  }
  return value;
}

function availableExternalUsername(
  preferred: string,
  subject: string,
  provider: ExternalIdentityProvider,
  repository: IdentityRepository
): string {
  const base = preferred.slice(0, 64);
  if (!repository.usernameExists(base)) return base;
  const suffix = `-${subject.replaceAll(/[^A-Za-z0-9]/g, "").slice(-10) || provider}`;
  const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
  if (!repository.usernameExists(candidate)) return candidate;
  const randomSuffix = `-${randomBytes(4).toString("hex")}`;
  return `${base.slice(0, 64 - randomSuffix.length)}${randomSuffix}`;
}

function oauthUnavailable(provider: ExternalIdentityProvider): ApplicationError {
  return new ApplicationError(
    provider === "github"
      ? "GITHUB_OAUTH_UNAVAILABLE"
      : "DISCORD_OAUTH_UNAVAILABLE",
    503,
    `${providerDisplayName(provider)} OAuth is not configured.`
  );
}

function oauthFailedCode(provider: ExternalIdentityProvider) {
  return provider === "github"
    ? ("GITHUB_OAUTH_FAILED" as const)
    : ("DISCORD_OAUTH_FAILED" as const);
}

function providerDisplayName(provider: ExternalIdentityProvider): string {
  return provider === "github" ? "GitHub" : "Discord";
}

function oauthCookieName(provider: ExternalIdentityProvider): string {
  return provider === "github"
    ? GITHUB_OAUTH_COOKIE_NAME
    : DISCORD_OAUTH_COOKIE_NAME;
}

function createSessionToken(
  createdAt: number,
  expiresAt: number
): {
  readonly cookieValue: string;
  readonly stored: {
    readonly id: string;
    readonly secretHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  };
} {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  return {
    cookieValue: `${id}.${secret}`,
    stored: {
      id,
      secretHash: hashSessionSecret(secret),
      createdAt,
      expiresAt,
    },
  };
}

function readSessionToken(
  cookieHeader: string | undefined
): { readonly id: string; readonly secret: string } | null {
  const value = readCookie(cookieHeader, COOKIE_NAME);
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator < 1 || separator === value.length - 1) return null;
  return {
    id: value.slice(0, separator),
    secret: value.slice(separator + 1),
  };
}

function readCookie(
  header: string | undefined,
  name: string
): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function verifyPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  const [algorithm, saltValue, keyValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !keyValue) return false;
  const expected = Buffer.from(keyValue, "base64url");
  const actual = (await scrypt(
    password,
    Buffer.from(saltValue, "base64url"),
    expected.length
  )) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSessionSecret(secret), "base64url");
  const expected = Buffer.from(expectedHash, "base64url");
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}

function validUsername(value: unknown): string {
  const username = requiredText(value, "username", 64);
  if (!/^[\p{L}\p{N}._-]+$/u.test(username)) {
    throw invalidInput(
      "Username may contain letters, numbers, dots, underscores, and hyphens.",
      "username"
    );
  }
  return username;
}

function validDiscordUserId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(value)
  ) {
    throw invalidInput(
      "discordUserId must be a Discord snowflake ID.",
      "discordUserId"
    );
  }
  return value;
}

function validDisplayName(value: unknown): string {
  return requiredText(value, "displayName", 100);
}

function validPassword(
  value: unknown,
  field = "password"
): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw invalidInput(
      "Password must contain between 8 and 200 characters.",
      field
    );
  }
  return value;
}

function validAvatarUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw invalidInput("Avatar URL must be an absolute URL.", "avatarUrl");
  }
  try {
    return new URL(value).toString();
  } catch {
    throw invalidInput("Avatar URL must be an absolute URL.", "avatarUrl");
  }
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw invalidInput(`${field} is required.`, field);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw invalidInput(
      `${field} must contain between 1 and ${maxLength} characters.`,
      field
    );
  }
  return text;
}

function invalidInput(message: string, field: string | undefined) {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}

function usernameTaken() {
  return new ApplicationError(
    "USERNAME_TAKEN",
    409,
    "Username is already in use.",
    "username"
  );
}

function isUniqueConstraint(error: unknown, column: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(column)
  );
}
