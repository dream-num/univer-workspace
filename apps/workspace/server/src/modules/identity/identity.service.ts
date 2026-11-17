import { agentActivityWindow, authenticateStoredPrincipal, AGENT_TTL_MS } from "./agent-activity.js";
import { createSessionToken, secretMatches } from "./session-token.js";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  ApplicationError,
  type ApplicationErrorCode,
} from "../../middleware/errors.js";
import { logger } from "../../logging/logger.js";
import { recordSignup } from "../../middleware/loop-metrics.js";
import type { EmailSender } from "../../integrations/email/index.js";
import type { WriteSource } from "./write-source.js";
import type {
  IdentityRepository,
  StoredSession,
} from "./identity.repository.js";
import { emailLoginMessage } from "./email-login-mail.js";
import { createSourceRateLimiter } from "./source-rate-limiter.js";
import type {
  AgentCreation,
  AuthenticatedSession,
  CreatedAgent,
  Principal,
  PrincipalUser,
  CliAuthorizationExchange,
  CliAuthorizationStart,
  EmailLogin,
  EmailLoginCodeRequest,
  IssuedEmailLoginCode,
  IssuedSession,
  IssueSessionOptions,
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
  GoogleOAuthProvider,
} from "./identity.types.js";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "workspace_session";
const GITHUB_OAUTH_COOKIE_NAME = "workspace_github_oauth";
const GOOGLE_OAUTH_COOKIE_NAME = "workspace_google_oauth";
const DISCORD_OAUTH_COOKIE_NAME = "workspace_discord_oauth";
const CLI_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const CLI_AUTHORIZATION_POLL_INTERVAL_SECONDS = 2;
const CLI_AUTHORIZATION_CAPACITY = 10_000;
const CLI_USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_RESEND_INTERVAL_MS = 60 * 1000;
const EMAIL_CODE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_CODE_WINDOW_LIMIT = 5;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const DEFAULT_AGENT_LABEL = "agent";
const MAX_AGENT_CLIENT_NAME_LENGTH = 40;

interface PendingCliAuthorization {
  readonly deviceCodeHash: string;
  readonly userCode: string;
  readonly expiresAt: number;
  approvedUserId?: string;
  exchanging?: boolean;
}

export interface IdentityModule {
  initialize(): Promise<void>;
  readonly cookieName: string;
  readonly sessionTtlMs: number;
  readonly githubOAuthCookieName: string;
  readonly googleOAuthCookieName: string;
  readonly discordOAuthCookieName: string;
  registerWithPassword(input: PasswordRegistration): Promise<IssuedSession>;
  loginWithPassword(
    input: PasswordLogin,
    writeSource: WriteSource
  ): Promise<IssuedSession>;
  requestEmailLoginCode(
    input: EmailLoginCodeRequest
  ): Promise<IssuedEmailLoginCode>;
  loginWithEmailCode(input: EmailLogin): Promise<IssuedSession>;
  loginWithDiscordBot(input: DiscordBotLogin): Promise<IssuedSession>;
  /**
   * Creates an agent User with its Personal Space and no credential. Every creation path goes
   * through here, so the per-source rate limit cannot be skipped.
   */
  createAgent(input: AgentCreation): Promise<CreatedAgent>;
  startCliAuthorization(): CliAuthorizationStart;
  approveCliAuthorization(
    cookieHeader: string | undefined,
    userCode: unknown
  ): Promise<AuthenticatedSession>;
  exchangeCliAuthorization(deviceCode: unknown): Promise<CliAuthorizationExchange>;
  changePassword(
    cookieHeader: string | undefined,
    input: PasswordChange
  ): Promise<void>;
  getSession(cookieHeader: string | undefined): Promise<SessionView>;
  getRealtimeSession(cookieHeader: string | undefined): Promise<{
    readonly user: User;
    readonly sessionId: string;
    readonly expiresAt: number;
  } | null>;
  requireSession(cookieHeader: string | undefined): Promise<Principal>;
  issueSession(
    user: User,
    writeSource: WriteSource,
    options?: IssueSessionOptions
  ): Promise<IssuedSession>;
  logout(cookieHeader: string | undefined): Promise<void>;
  updateCurrentUser(
    cookieHeader: string | undefined,
    patch: UserProfilePatch
  ): Promise<PrincipalUser>;
  startGitHubOAuth(input: {
    readonly intent: "login" | "link";
    readonly returnTo: unknown;
    readonly cookieHeader: string | undefined;
  }): Promise<{
    readonly authorizationUrl: string;
    readonly cookieValue: string;
  }>;
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
  unlinkGitHub(cookieHeader: string | undefined): Promise<AuthenticatedSession>;
  startGoogleOAuth(input: {
    readonly intent: "login" | "link";
    readonly returnTo: unknown;
    readonly cookieHeader: string | undefined;
  }): Promise<{
    readonly authorizationUrl: string;
    readonly cookieValue: string;
  }>;
  finishGoogleOAuth(input: {
    readonly code: unknown;
    readonly state: unknown;
    readonly providerError: unknown;
    readonly oauthCookieHeader: string | undefined;
    readonly sessionCookieHeader: string | undefined;
  }): Promise<{
    readonly returnTo: string;
    readonly issuedSession: IssuedSession | null;
  }>;
  unlinkGoogle(cookieHeader: string | undefined): Promise<AuthenticatedSession>;
  startDiscordOAuth(input: {
    readonly intent: "login" | "link";
    readonly returnTo: unknown;
    readonly cookieHeader: string | undefined;
  }): Promise<{
    readonly authorizationUrl: string;
    readonly cookieValue: string;
  }>;
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
  unlinkDiscord(cookieHeader: string | undefined): Promise<AuthenticatedSession>;
  findUsers(userIds: readonly string[]): Promise<readonly User[]>;
  /**
   * A shared page of this Node was served to a reader. When an unclaimed agent owns it, its expiry
   * moves 30 days out, as when the agent authenticates; either happens at most once a day.
   */
  recordAgentPageView(nodeId: string): Promise<void>;
  /** Whether the cookie holds a valid session, without the cleanup and agent activity that reading one causes. */
  hasSession(cookieHeader: string | undefined): Promise<boolean>;
  /**
   * Like requireSession, but rejects a downstream session issued for a PAT or MCP grant, so it
   * cannot create access (a token, a CLI login, an OAuth code, a linked identity) that outlives
   * that token's revocation.
   */
  requireInteractiveSession(cookieHeader: string | undefined): Promise<Principal>;
}

export function createIdentityModule(options: {
  readonly repository: IdentityRepository;
  readonly onSessionsDeleted?: (sessionIds: readonly string[]) => void;
  readonly sessionTtlMs: number;
  readonly now?: () => number;
  readonly githubOAuthProvider?: GitHubOAuthProvider | null;
  readonly googleOAuthProvider?: GoogleOAuthProvider | null;
  readonly discordOAuthProvider?: DiscordOAuthProvider | null;
  readonly oauthStateSecret?: string;
  readonly passwordAuthEnabled?: boolean;
  readonly emailSender?: EmailSender | null;
  readonly emailAuthEnabled?: boolean;
  readonly trialDeployment?: boolean;
  /** Agent creations allowed per source IP per hour; 0 disables creation. Defaults to 5. */
  readonly agentCreateLimitPerHour?: number;
}): IdentityModule {
  const now = options.now ?? Date.now;
  const repository = options.repository;
  const githubOAuthProvider = options.githubOAuthProvider ?? null;
  const googleOAuthProvider = options.googleOAuthProvider ?? null;
  const discordOAuthProvider = options.discordOAuthProvider ?? null;
  const oauthStateSecret = options.oauthStateSecret ?? "";
  const githubOAuthEnabled = Boolean(
    githubOAuthProvider && oauthStateSecret
  );
  const googleOAuthEnabled = Boolean(
    googleOAuthProvider && oauthStateSecret
  );
  const discordOAuthEnabled = Boolean(
    discordOAuthProvider && oauthStateSecret
  );
  const passwordAuthEnabled = options.passwordAuthEnabled ?? true;
  const emailSender = options.emailSender ?? null;
  const emailAuthEnabled =
    options.emailAuthEnabled ?? emailSender !== null;
  const trialDeployment = options.trialDeployment ?? false;
  const agentCreateLimitPerHour = options.agentCreateLimitPerHour ?? 5;
  const agentCreateLimiter = createSourceRateLimiter(agentCreateLimitPerHour, now);
  const cliAuthorizations = new Map<string, PendingCliAuthorization>();
  const cliAuthorizationDevices = new Map<string, string>();

  function anonymousSession(): SessionView {
    return {
      authenticated: false,
      githubOAuthEnabled,
      googleOAuthEnabled,
      discordOAuthEnabled,
      passwordAuthEnabled,
      emailAuthEnabled,
      guestAuthEnabled: agentCreateLimitPerHour > 0,
    };
  }

  function requirePasswordAuth(): void {
    if (passwordAuthEnabled) return;
    throw new ApplicationError(
      "PASSWORD_AUTH_DISABLED",
      403,
      "Password authentication is disabled."
    );
  }

  function requireEmailSender(): EmailSender {
    if (!emailAuthEnabled || emailSender === null) {
      throw new ApplicationError(
        "EMAIL_AUTH_DISABLED",
        403,
        "Email authentication is disabled."
      );
    }
    return emailSender;
  }

  async function authenticatedSession(user: User | PrincipalUser): Promise<AuthenticatedSession> {
    const stored = "kind" in user ? user : await repository.findPrincipal(user.id);
    if (!stored) throw new Error("Session User is missing");
    return {
      authenticated: true,
      githubOAuthEnabled,
      googleOAuthEnabled,
      discordOAuthEnabled,
      passwordAuthEnabled,
      emailAuthEnabled,
      trialDeployment,
      user: principalUser(user, stored),
      authenticationMethods: await repository.authenticationMethods(user.id),
    };
  }

  /** The User as sessions and the token exchange show it: the profile plus its principal kind. */
  function principalUser(user: User, stored: PrincipalUser): PrincipalUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      ...(stored.kind === "agent"
        ? { kind: "agent", claimed: stored.claimed }
        : { kind: "human" }),
    };
  }

  async function storedSession(cookieHeader: string | undefined, readOnly = false): Promise<StoredSession | null> {
    const token = readSessionToken(cookieHeader);
    if (!token) return null;
    const stored = await repository.findSession(token.id);
    if (!stored) return null;
    if (stored.expiresAt <= now()) {
      if (readOnly) return null;
      await repository.deleteSession(stored.sessionId);
      options.onSessionsDeleted?.([stored.sessionId]);
      return null;
    }
    if (!secretMatches(token.secret, stored.secretHash)) return null;
    const authenticated = authenticateStoredPrincipal(stored, now());
    if (!authenticated) return null;
    if (authenticated.activity && !readOnly) {
      const { at, staleBefore, expiresAt } = authenticated.activity;
      await repository.touchUnclaimedAgent({ userId: stored.id }, at, staleBefore, expiresAt);
    }
    return stored;
  }

  async function getSession(cookieHeader: string | undefined): Promise<SessionView> {
    const stored = await storedSession(cookieHeader);
    return stored ? authenticatedSession(stored) : anonymousSession();
  }

  async function requireSession(cookieHeader: string | undefined): Promise<Principal> {
    return principal(await storedSession(cookieHeader));
  }

  async function requireInteractiveSession(cookieHeader: string | undefined): Promise<Principal> {
    const stored = await storedSession(cookieHeader);
    if (stored?.tokenIssued) {
      throw new ApplicationError(
        "FORBIDDEN",
        403,
        "This action requires an interactive sign-in, not a session issued for an access token."
      );
    }
    return principal(stored);
  }

  function principal(stored: StoredSession | null): Principal {
    if (!stored) {
      throw new ApplicationError(
        "UNAUTHENTICATED",
        401,
        "Authentication is required."
      );
    }
    return {
      user: principalUser(stored, stored),
      writeSource: stored.writeSource,
      tokenIssued: stored.tokenIssued,
    };
  }

  async function issueSession(
    user: User,
    writeSource: WriteSource,
    sessionOptions: IssueSessionOptions = {}
  ): Promise<IssuedSession> {
    const ttlMs = sessionOptions.ttlMs ?? options.sessionTtlMs;
    if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > options.sessionTtlMs) {
      throw invalidInput("Session ttlMs must be a positive integer not above the session lifetime.", "ttlMs");
    }
    const createdAt = now();
    const issued = createSessionToken(
      createdAt,
      createdAt + ttlMs,
      writeSource,
      sessionOptions.issuedFor
    );
    await repository.createSession(user.id, issued.stored);
    return {
      cookieValue: issued.cookieValue,
      view: await authenticatedSession(user),
    };
  }

  return {
    async initialize() {
      const expiredSessionIds = await repository.deleteExpiredSessions(now());
      options.onSessionsDeleted?.(expiredSessionIds);
    },
    cookieName: COOKIE_NAME,
    githubOAuthCookieName: GITHUB_OAUTH_COOKIE_NAME,
    googleOAuthCookieName: GOOGLE_OAUTH_COOKIE_NAME,
    discordOAuthCookieName: DISCORD_OAUTH_COOKIE_NAME,
    sessionTtlMs: options.sessionTtlMs,

    async findUsers(userIds) {
      return repository.findUsers(userIds);
    },

    async hasSession(cookieHeader) {
      return (await storedSession(cookieHeader, true)) !== null;
    },

    async recordAgentPageView(nodeId) {
      const { at, staleBefore, expiresAt } = agentActivityWindow(now());
      await repository.touchUnclaimedAgent({ nodeId }, at, staleBefore, expiresAt);
    },

    async registerWithPassword(input) {
      requirePasswordAuth();
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
        createdAt + options.sessionTtlMs,
        "browser"
      );

      try {
        await repository.createPasswordUser({
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
        if (await repository.isIdentityConflict(error, "username")) {
          throw usernameTaken();
        }
        throw error;
      }
      recordSignup("password", user.id, input.returnTo);

      return {
        cookieValue: issued.cookieValue,
        view: await authenticatedSession(user),
      };
    },

    async loginWithPassword(input, writeSource) {
      requirePasswordAuth();
      const username = validUsername(input.username);
      const password = validPassword(input.password);
      const credential = await repository.findCredential(username);
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

      return issueSession(credential, writeSource);
    },

    async requestEmailLoginCode(input) {
      const sender = requireEmailSender();
      const email = validEmail(input.email);
      const requestedAt = now();
      await repository.deleteEmailLoginCodesBefore(
        requestedAt - EMAIL_CODE_WINDOW_MS
      );
      const lastRequestedAt = await repository.latestEmailLoginCodeCreatedAt(email);
      if (
        lastRequestedAt !== null &&
        requestedAt - lastRequestedAt < EMAIL_CODE_RESEND_INTERVAL_MS
      ) {
        throw new ApplicationError(
          "EMAIL_CODE_RATE_LIMITED",
          429,
          "A sign-in code was sent recently. Wait a moment before requesting another.",
          "email"
        );
      }
      if (
        await repository.countEmailLoginCodesSince(
          email,
          requestedAt - EMAIL_CODE_WINDOW_MS
        ) >= EMAIL_CODE_WINDOW_LIMIT
      ) {
        throw new ApplicationError(
          "EMAIL_CODE_RATE_LIMITED",
          429,
          "Too many sign-in codes were requested. Try again later.",
          "email"
        );
      }

      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const id = randomUUID();
      await repository.createEmailLoginCode({
        id,
        email,
        codeHash: await hashPassword(code),
        createdAt: requestedAt,
        expiresAt: requestedAt + EMAIL_CODE_TTL_MS,
      });
      try {
        await sender.send(
          emailLoginMessage({
            to: email,
            code,
            ttlMinutes: Math.round(EMAIL_CODE_TTL_MS / 60_000),
          })
        );
      } catch (error) {
        logger.error({ err: error }, "email sign-in code delivery failed");
        await repository.deleteEmailLoginCode(id);
        throw new ApplicationError(
          "EMAIL_DELIVERY_FAILED",
          503,
          "The sign-in code could not be delivered. Try again later.",
          "email"
        );
      }
      await repository.consumeOtherEmailLoginCodes(email, id, requestedAt);
      return {
        expiresIn: Math.floor(EMAIL_CODE_TTL_MS / 1_000),
        resendAfter: Math.floor(EMAIL_CODE_RESEND_INTERVAL_MS / 1_000),
      };
    },

    async loginWithEmailCode(input) {
      requireEmailSender();
      const email = validEmail(input.email);
      const code = validEmailCode(input.code);
      const verifiedAt = now();
      const stored = await repository.findEmailLoginCode(email, verifiedAt);
      if (stored === null) {
        throw invalidEmailCode();
      }
      if (stored.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        await repository.deleteEmailLoginCode(stored.id);
        throw new ApplicationError(
          "INVALID_EMAIL_CODE",
          400,
          "Too many incorrect attempts. Request a new sign-in code.",
          "code"
        );
      }
      if (!(await verifyPassword(code, stored.codeHash))) {
        await repository.incrementEmailLoginCodeAttempts(stored.id);
        throw invalidEmailCode();
      }
      if (!(await repository.consumeEmailLoginCode(stored.id, verifiedAt))) {
        throw invalidEmailCode();
      }
      await repository.consumeOtherEmailLoginCodes(email, stored.id, verifiedAt);

      const existing = await repository.findUserByEmail(email);
      if (existing) return issueSession(existing, "browser");

      const createdAt = verifiedAt;
      const issued = createSessionToken(
        createdAt,
        createdAt + options.sessionTtlMs,
        "browser"
      );
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const user: User = {
          id: randomUUID(),
          username: usernameFromEmail(email, attempt),
          displayName: displayNameFromEmail(email),
          avatarUrl: null,
        };
        try {
          await repository.createEmailUser({
            user,
            email,
            personalSpace: {
              id: randomUUID(),
              name: `${user.displayName} 的个人空间`,
            },
            session: issued.stored,
            createdAt,
          });
        } catch (error) {
          if (await repository.isIdentityConflict(error, "username")) continue;
          if (await repository.isIdentityConflict(error, "email")) {
            const concurrent = await repository.findUserByEmail(email);
            if (concurrent) return issueSession(concurrent, "browser");
          }
          throw error;
        }
        recordSignup("email", user.id, input.returnTo);
        return {
          cookieValue: issued.cookieValue,
          view: await authenticatedSession(user),
        };
      }
      throw new ApplicationError(
        "CONFLICT",
        409,
        "A Workspace account could not be created for this email address."
      );
    },

    async createAgent(input) {
      if (!agentCreateLimiter.take(input.originIp)) {
        throw new ApplicationError(
          "AGENT_CREATE_RATE_LIMITED",
          429,
          "Too many agents were created from this address. Try again later."
        );
      }
      const explicitLabel = cleanCallerName(input.label);
      const clientName = explicitLabel ? undefined : agentClientName(input.clientName);
      const label = explicitLabel || clientName || DEFAULT_AGENT_LABEL;
      const createdAt = now();
      const expiresAt = createdAt + AGENT_TTL_MS;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const username = agentUsername(label);
        const user: User = {
          id: randomUUID(),
          username,
          // Many agents share one client name; the username's random suffix tells them apart.
          displayName: clientName === undefined ? label : `${clientName} · ${username.slice(-4)}`,
          avatarUrl: null,
        };
        try {
          await repository.createAgentUser({
            user,
            personalSpace: {
              id: randomUUID(),
              name: `${user.displayName} 的个人空间`,
            },
            originLabel: label,
            createdAt,
            expiresAt,
          });
        } catch (error) {
          if (await repository.isIdentityConflict(error, "username")) continue;
          throw error;
        }
        return { user, expiresAt };
      }
      throw new ApplicationError(
        "CONFLICT",
        409,
        "A username could not be generated for this agent."
      );
    },

    async loginWithDiscordBot(input) {
      const discordUserId = validDiscordUserId(input.discordUserId);
      const suppliedUsername =
        input.username === undefined
          ? undefined
          : validUsername(input.username);
      const existing = await repository.findExternalIdentity(
        "discord",
        discordUserId
      );
      if (existing) {
        if (
          suppliedUsername !== undefined &&
          suppliedUsername !== existing.providerUsername
        ) {
          await repository.updateExternalUsername(
            "discord",
            discordUserId,
            suppliedUsername,
            now()
          );
        }
        return issueSession(existing.user, "agent");
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
        username: await availableExternalUsername(
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
        createdAt + options.sessionTtlMs,
        "agent"
      );
      try {
        await repository.createExternalUser({
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
        if (await repository.isIdentityConflict(error, "externalIdentity")) {
          const concurrent = await repository.findExternalIdentity(
            "discord",
            discordUserId
          );
          if (concurrent) return issueSession(concurrent.user, "agent");
        }
        throw error;
      }
      recordSignup("discord_bot", user.id, undefined);
      return {
        cookieValue: token.cookieValue,
        view: await authenticatedSession(user),
      };
    },

    startCliAuthorization() {
      deleteExpiredCliAuthorizations();
      if (cliAuthorizations.size >= CLI_AUTHORIZATION_CAPACITY) {
        throw new ApplicationError(
          "CLI_AUTHORIZATION_UNAVAILABLE",
          503,
          "CLI browser login is temporarily unavailable. Try again shortly."
        );
      }
      const deviceCode = randomBytes(32).toString("base64url");
      const deviceCodeHash = hashCliDeviceCode(deviceCode);
      let userCode = createCliUserCode();
      while (cliAuthorizations.has(userCode)) {
        userCode = createCliUserCode();
      }
      cliAuthorizations.set(userCode, {
        deviceCodeHash,
        userCode,
        expiresAt: now() + CLI_AUTHORIZATION_TTL_MS,
      });
      cliAuthorizationDevices.set(deviceCodeHash, userCode);
      const verificationUri = "/cli-login";
      return {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete: `${verificationUri}?userCode=${encodeURIComponent(userCode)}`,
        expiresIn: Math.floor(CLI_AUTHORIZATION_TTL_MS / 1000),
        interval: CLI_AUTHORIZATION_POLL_INTERVAL_SECONDS,
      };
    },

    async approveCliAuthorization(cookieHeader, inputUserCode) {
      const session = await requireInteractiveSession(cookieHeader);
      const userCode = validCliUserCode(inputUserCode);
      const authorization = cliAuthorizations.get(userCode);
      if (!authorization) throw invalidCliAuthorization();
      if (authorization.expiresAt <= now()) {
        deleteCliAuthorization(authorization);
        throw expiredCliAuthorization();
      }
      if (
        authorization.approvedUserId !== undefined &&
        authorization.approvedUserId !== session.user.id
      ) {
        throw new ApplicationError(
          "CONFLICT",
          409,
          "This CLI login request was already approved by another User."
        );
      }
      authorization.approvedUserId = session.user.id;
      return authenticatedSession(session.user);
    },

    async exchangeCliAuthorization(inputDeviceCode) {
      const deviceCode = validCliDeviceCode(inputDeviceCode);
      const deviceCodeHash = hashCliDeviceCode(deviceCode);
      const userCode = cliAuthorizationDevices.get(deviceCodeHash);
      const authorization = userCode
        ? cliAuthorizations.get(userCode)
        : undefined;
      if (
        !authorization ||
        !secretsEqual(deviceCodeHash, authorization.deviceCodeHash)
      ) {
        throw invalidCliAuthorization();
      }
      if (authorization.expiresAt <= now()) {
        deleteCliAuthorization(authorization);
        throw expiredCliAuthorization();
      }
      if (authorization.approvedUserId === undefined) {
        return { status: "pending" };
      }
      if (authorization.exchanging) throw invalidCliAuthorization();
      authorization.exchanging = true;
      try {
        const user = await repository.findUser(authorization.approvedUserId);
        if (!user) {
          deleteCliAuthorization(authorization);
          throw invalidCliAuthorization();
        }
        const issuedSession = await issueSession(user, "agent");
        deleteCliAuthorization(authorization);
        return { status: "authorized", issuedSession };
      } finally {
        delete authorization.exchanging;
      }
    },

    async changePassword(cookieHeader, input) {
      requirePasswordAuth();
      const session = await requireInteractiveSession(cookieHeader);
      const currentPassword = validPassword(
        input.currentPassword,
        "currentPassword"
      );
      const newPassword = validPassword(input.newPassword, "newPassword");
      const credential = await repository.findCredentialByUserId(
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
      await repository.updatePasswordHash(
        session.user.id,
        await hashPassword(newPassword),
        now()
      );
    },

    getSession,
    async getRealtimeSession(cookieHeader) {
      const stored = await storedSession(cookieHeader);
      if (!stored) return null;
      return {
        user: {
          id: stored.id,
          username: stored.username,
          displayName: stored.displayName,
          avatarUrl: stored.avatarUrl,
        },
        sessionId: stored.sessionId,
        expiresAt: stored.expiresAt,
      };
    },
    requireSession,
    issueSession,
    requireInteractiveSession,

    async logout(cookieHeader) {
      const token = readSessionToken(cookieHeader);
      if (!token) return;
      const stored = await repository.findSession(token.id);
      if (stored && secretMatches(token.secret, stored.secretHash)) {
        await repository.deleteSession(token.id);
        options.onSessionsDeleted?.([token.id]);
      }
    },

    async updateCurrentUser(cookieHeader, patch) {
      const session = await requireSession(cookieHeader);
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

      const fields = {
        ...(patch.username !== undefined && { username: validUsername(patch.username) }),
        ...(patch.displayName !== undefined && { displayName: validDisplayName(patch.displayName) }),
        ...(patch.avatarUrl !== undefined && { avatarUrl: validAvatarUrl(patch.avatarUrl) }),
      };
      try {
        const user = await repository.updateUser(session.user.id, fields, now());
        return principalUser(user, session.user);
      } catch (error) {
        if (await repository.isIdentityConflict(error, "username")) {
          throw usernameTaken();
        }
        throw error;
      }
    },

    async startGitHubOAuth(input) {
      return startExternalOAuth("github", githubOAuthProvider, input);
    },

    async startGoogleOAuth(input) {
      return startExternalOAuth("google", googleOAuthProvider, input);
    },

    async startDiscordOAuth(input) {
      return startExternalOAuth("discord", discordOAuthProvider, input);
    },

    async finishGitHubOAuth(input) {
      return finishExternalOAuth("github", githubOAuthProvider, input);
    },

    async finishGoogleOAuth(input) {
      return finishExternalOAuth("google", googleOAuthProvider, input);
    },

    async finishDiscordOAuth(input) {
      return finishExternalOAuth("discord", discordOAuthProvider, input);
    },

    async unlinkGitHub(cookieHeader) {
      return unlinkExternalIdentity("github", cookieHeader);
    },

    async unlinkGoogle(cookieHeader) {
      return unlinkExternalIdentity("google", cookieHeader);
    },

    async unlinkDiscord(cookieHeader) {
      return unlinkExternalIdentity("discord", cookieHeader);
    },
  };

  async function startExternalOAuth(
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
        ? (await requireInteractiveSession(input.cookieHeader)).user.id
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
    const existing = await repository.findExternalIdentity(
      provider,
      identity.subject
    );
    if (oauth.intent === "link") {
      const session = await requireInteractiveSession(input.sessionCookieHeader);
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
        await repository.linkExternalIdentity({
          provider,
          userId: session.user.id,
          providerSubject: identity.subject,
          providerUsername: identity.username,
          updatedAt: now(),
        });
      } catch (error) {
        if (await repository.isIdentityConflict(error, "externalIdentity")) {
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
      await repository.updateExternalUsername(
        provider,
        identity.subject,
        identity.username,
        now()
      );
      const user =
        provider === "discord"
          ? await completeDiscordPlaceholderProfile(existing.user, identity)
          : existing.user;
      return {
        returnTo: oauth.returnTo,
        issuedSession: await issueSession(user, "browser"),
      };
    }

    const createdAt = now();
    const user: User = {
      id: randomUUID(),
      username: await availableExternalUsername(
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
      createdAt + options.sessionTtlMs,
      "browser"
    );
    await repository.createExternalUser({
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
    recordSignup(provider, user.id, oauth.returnTo);
    return {
      returnTo: oauth.returnTo,
      issuedSession: {
        cookieValue: token.cookieValue,
        view: await authenticatedSession(user),
      },
    };
  }

  async function unlinkExternalIdentity(
    provider: ExternalIdentityProvider,
    cookieHeader: string | undefined
  ) {
    const session = await requireSession(cookieHeader);
    if (!(await repository.removeExternalIdentity(session.user.id, provider, passwordAuthEnabled))) {
      throw new ApplicationError(
        "CONFLICT",
        409,
        `${providerDisplayName(provider)} cannot be unlinked because it is the last authentication method.`
      );
    }
    const user = await repository.findUser(session.user.id);
    if (!user) {
      throw new Error("Authenticated user is missing.");
    }
    return authenticatedSession(user);
  }

  async function completeDiscordPlaceholderProfile(
    user: User,
    identity: ExternalIdentity
  ): Promise<User> {
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
    const patch = {
      ...(usernameIsPlaceholder && { username: await availableExternalUsername(identity.username, identity.subject, "discord", repository) }),
      ...(displayNameIsPlaceholder && { displayName: validDisplayName(identity.displayName) }),
      ...(avatarIsMissing && { avatarUrl: identity.avatarUrl }),
    };
    return repository.updateUser(user.id, patch, now(), user);
  }

  function deleteExpiredCliAuthorizations(): void {
    for (const authorization of cliAuthorizations.values()) {
      if (authorization.expiresAt <= now()) {
        deleteCliAuthorization(authorization);
      }
    }
  }

  function deleteCliAuthorization(authorization: PendingCliAuthorization): void {
    cliAuthorizations.delete(authorization.userCode);
    cliAuthorizationDevices.delete(authorization.deviceCodeHash);
  }
}

function createCliUserCode(): string {
  const bytes = randomBytes(8);
  const characters = Array.from(bytes, (byte) =>
    CLI_USER_CODE_ALPHABET.charAt(byte % CLI_USER_CODE_ALPHABET.length)
  ).join("");
  return `${characters.slice(0, 4)}-${characters.slice(4)}`;
}

function validCliUserCode(value: unknown): string {
  if (typeof value !== "string") throw invalidCliAuthorization();
  const compact = value.trim().toUpperCase().replaceAll("-", "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/u.test(compact)) {
    throw invalidCliAuthorization();
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function validCliDeviceCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,64}$/u.test(value)) {
    throw invalidCliAuthorization();
  }
  return value;
}

function hashCliDeviceCode(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function invalidCliAuthorization(): ApplicationError {
  return new ApplicationError(
    "CLI_AUTHORIZATION_INVALID",
    400,
    "The CLI login request is invalid or has already been used."
  );
}

function expiredCliAuthorization(): ApplicationError {
  return new ApplicationError(
    "CLI_AUTHORIZATION_EXPIRED",
    410,
    "The CLI login request has expired. Start login again from the CLI."
  );
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
      (parsed.provider !== "github" &&
        parsed.provider !== "google" &&
        parsed.provider !== "discord") ||
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

async function availableExternalUsername(
  preferred: string,
  subject: string,
  provider: ExternalIdentityProvider,
  repository: IdentityRepository
): Promise<string> {
  const base = preferred.slice(0, 64);
  if (!(await repository.usernameExists(base))) return base;
  const suffix = `-${subject.replaceAll(/[^A-Za-z0-9]/g, "").slice(-10) || provider}`;
  const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
  if (!(await repository.usernameExists(candidate))) return candidate;
  const randomSuffix = `-${randomBytes(4).toString("hex")}`;
  return `${base.slice(0, 64 - randomSuffix.length)}${randomSuffix}`;
}

const OAUTH_PROVIDERS: Record<
  ExternalIdentityProvider,
  {
    readonly displayName: string;
    readonly cookieName: string;
    readonly unavailableCode: ApplicationErrorCode;
    readonly failedCode: ApplicationErrorCode;
  }
> = {
  github: {
    displayName: "GitHub",
    cookieName: GITHUB_OAUTH_COOKIE_NAME,
    unavailableCode: "GITHUB_OAUTH_UNAVAILABLE",
    failedCode: "GITHUB_OAUTH_FAILED",
  },
  google: {
    displayName: "Google",
    cookieName: GOOGLE_OAUTH_COOKIE_NAME,
    unavailableCode: "GOOGLE_OAUTH_UNAVAILABLE",
    failedCode: "GOOGLE_OAUTH_FAILED",
  },
  discord: {
    displayName: "Discord",
    cookieName: DISCORD_OAUTH_COOKIE_NAME,
    unavailableCode: "DISCORD_OAUTH_UNAVAILABLE",
    failedCode: "DISCORD_OAUTH_FAILED",
  },
};

function oauthUnavailable(provider: ExternalIdentityProvider): ApplicationError {
  return new ApplicationError(
    OAUTH_PROVIDERS[provider].unavailableCode,
    503,
    `${providerDisplayName(provider)} OAuth is not configured.`
  );
}

function oauthFailedCode(
  provider: ExternalIdentityProvider
): ApplicationErrorCode {
  return OAUTH_PROVIDERS[provider].failedCode;
}

function providerDisplayName(provider: ExternalIdentityProvider): string {
  return OAUTH_PROVIDERS[provider].displayName;
}

function oauthCookieName(provider: ExternalIdentityProvider): string {
  return OAUTH_PROVIDERS[provider].cookieName;
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

function validEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Email is required.", "email");
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw invalidInput("Enter a valid email address.", "email");
  }
  return email;
}

function validEmailCode(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]{6}$/u.test(value.trim())) {
    throw invalidInput("Enter the 6-digit sign-in code.", "code");
  }
  return value.trim();
}

function invalidEmailCode(): ApplicationError {
  return new ApplicationError(
    "INVALID_EMAIL_CODE",
    400,
    "The sign-in code is invalid or has expired.",
    "code"
  );
}

function usernameFromEmail(email: string, attempt: number): string {
  const local = (email.split("@")[0] ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, ".")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 48);
  const base = local || "user";
  return attempt === 0
    ? base
    : `${base}-${randomBytes(3).toString("hex")}`;
}

function agentUsername(label: string): string {
  // Slicing first keeps the username within validUsername's 64 characters; a surrogate the
  // slice splits is not a letter, so the replace turns it into a hyphen.
  const slug = label
    .normalize("NFKC")
    .toLowerCase()
    .slice(0, 48)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  // shortcut: 36^4 suffixes per slug, so the five retries start failing near a million agents with one label; widen the suffix then.
  const suffix = randomInt(36 ** 4).toString(36).padStart(4, "0");
  return `${slug || DEFAULT_AGENT_LABEL}-${suffix}`;
}

/** Callers choose agent labels and client names freely, so keep them on one line without controls or bidi marks. */
export function cleanCallerName(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[\p{Cf}\p{Cs}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function agentClientName(name: string | null | undefined): string | undefined {
  return Array.from(cleanCallerName(name)).slice(0, MAX_AGENT_CLIENT_NAME_LENGTH).join("").trim() || undefined;
}

function displayNameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").trim().slice(0, 100);
  return local || "Workspace User";
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
