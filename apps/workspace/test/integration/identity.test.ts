import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import { ApplicationError } from "../../server/src/middleware/errors.js";
import {
  createIdentityModule,
  type DiscordOAuthProvider,
  IdentityRepository,
  type GitHubOAuthProvider,
} from "../../server/src/modules/identity/index.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("identity", () => {
  it("creates the user, credential, personal space, and session atomically", async () => {
    const database = openWorkspaceDatabase(":memory:");
    const identity = createIdentityModule({
      repository: new IdentityRepository(database),
      sessionTtlMs: 60_000,
      now: () => 1_000,
    });

    try {
      const issued = await identity.registerWithPassword({
        username: "alice",
        displayName: "Alice",
        password: "correct horse battery staple",
      });

      expect(issued.view).toMatchObject({
        authenticated: true,
        user: {
          username: "alice",
          displayName: "Alice",
        },
        authenticationMethods: {
          password: true,
          externalIdentities: [],
        },
      });
      expect(tableCount(database, "users")).toBe(1);
      expect(tableCount(database, "password_credentials")).toBe(1);
      expect(tableCount(database, "spaces")).toBe(1);
      expect(tableCount(database, "login_sessions")).toBe(1);

      const space = database.connection
        .prepare("SELECT type, owner_user_id FROM spaces")
        .get() as { readonly type: string; readonly owner_user_id: string };
      expect(space).toEqual({
        type: "personal",
        owner_user_id: issued.view.user.id,
      });

      await expect(
        identity.registerWithPassword({
          username: "ALICE",
          displayName: "Another Alice",
          password: "another secure password",
        })
      ).rejects.toMatchObject<ApplicationError>({
        code: "USERNAME_TAKEN",
        status: 409,
      });
      expect(tableCount(database, "users")).toBe(1);
      expect(tableCount(database, "spaces")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("persists sessions across application restarts and invalidates them on logout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "univer-workspace-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "product.sqlite");
    const firstDatabase = openWorkspaceDatabase(filename);
    const firstIdentity = createIdentityModule({
      repository: new IdentityRepository(firstDatabase),
      sessionTtlMs: 60_000,
      now: () => 1_000,
    });
    const issued = await firstIdentity.registerWithPassword({
      username: "bob",
      displayName: "Bob",
      password: "correct horse battery staple",
    });
    const cookie = `${firstIdentity.cookieName}=${issued.cookieValue}`;
    firstDatabase.close();

    const secondDatabase = openWorkspaceDatabase(filename);
    try {
      const secondIdentity = createIdentityModule({
        repository: new IdentityRepository(secondDatabase),
        sessionTtlMs: 60_000,
        now: () => 2_000,
      });
      const restoredSession = secondIdentity.getSession(cookie);
      expect(restoredSession).toMatchObject({
        authenticated: true,
        user: { username: "bob" },
      });
      expect(restoredSession).not.toHaveProperty("user.sessionId");
      expect(restoredSession).not.toHaveProperty("user.secretHash");
      expect(restoredSession).not.toHaveProperty("user.expiresAt");
      expect(
        secondIdentity.getSession(
          `${secondIdentity.cookieName}=${issued.cookieValue}tampered`
        )
      ).toEqual({
        authenticated: false,
        githubOAuthEnabled: false,
        discordOAuthEnabled: false,
      });

      secondIdentity.logout(cookie);
      expect(secondIdentity.getSession(cookie)).toEqual({
        authenticated: false,
        githubOAuthEnabled: false,
        discordOAuthEnabled: false,
      });
    } finally {
      secondDatabase.close();
    }
  });

  it("authenticates a registered user with their password", async () => {
    const database = openWorkspaceDatabase(":memory:");
    const identity = createIdentityModule({
      repository: new IdentityRepository(database),
      sessionTtlMs: 60_000,
    });

    try {
      await identity.registerWithPassword({
        username: "carol",
        displayName: "Carol",
        password: "correct horse battery staple",
      });

      await expect(
        identity.loginWithPassword({
          username: "Carol",
          password: "correct horse battery staple",
        })
      ).resolves.toMatchObject({
        view: {
          authenticated: true,
          user: { username: "carol" },
        },
      });
      await expect(
        identity.loginWithPassword({
          username: "carol",
          password: "wrong password",
        })
      ).rejects.toMatchObject<ApplicationError>({
        code: "INVALID_CREDENTIALS",
        status: 401,
      });
    } finally {
      database.close();
    }
  });

  it("hands an approved browser identity to the CLI through a one-time device code", async () => {
    const database = openWorkspaceDatabase(":memory:");
    let currentTime = 1_000;
    const identity = createIdentityModule({
      repository: new IdentityRepository(database),
      sessionTtlMs: 60_000,
      now: () => currentTime,
    });

    try {
      const browserSession = await identity.registerWithPassword({
        username: "device-user",
        displayName: "Device User",
        password: "correct horse battery staple",
      });
      const browserCookie = `${identity.cookieName}=${browserSession.cookieValue}`;
      const started = identity.startCliAuthorization();

      expect(started).toMatchObject({
        userCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u),
        verificationUri: "/cli-login",
        verificationUriComplete: `/cli-login?userCode=${started.userCode}`,
        expiresIn: 600,
        interval: 2,
      });
      expect(identity.exchangeCliAuthorization(started.deviceCode)).toEqual({
        status: "pending",
      });
      expect(
        identity.approveCliAuthorization(
          browserCookie,
          started.userCode.toLowerCase().replace("-", "")
        )
      ).toMatchObject({ user: { username: "device-user" } });

      const exchanged = identity.exchangeCliAuthorization(started.deviceCode);
      expect(exchanged).toMatchObject({
        status: "authorized",
        issuedSession: { view: { user: { username: "device-user" } } },
      });
      expect(tableCount(database, "login_sessions")).toBe(2);
      expect(() =>
        identity.exchangeCliAuthorization(started.deviceCode)
      ).toThrowError(expect.objectContaining({ code: "CLI_AUTHORIZATION_INVALID" }));

      const expiring = identity.startCliAuthorization();
      currentTime += 10 * 60 * 1000;
      expect(() =>
        identity.exchangeCliAuthorization(expiring.deviceCode)
      ).toThrowError(expect.objectContaining({ code: "CLI_AUTHORIZATION_EXPIRED" }));
    } finally {
      database.close();
    }
  });

  it("changes the current user's password", async () => {
    const database = openWorkspaceDatabase(":memory:");
    const identity = createIdentityModule({
      repository: new IdentityRepository(database),
      sessionTtlMs: 60_000,
    });

    try {
      const issued = await identity.registerWithPassword({
        username: "dana",
        displayName: "Dana",
        password: "original secure password",
      });
      const cookie = `${identity.cookieName}=${issued.cookieValue}`;

      await expect(
        identity.changePassword(cookie, {
          currentPassword: "incorrect password",
          newPassword: "replacement secure password",
        })
      ).rejects.toMatchObject<ApplicationError>({
        code: "INVALID_CURRENT_PASSWORD",
        status: 400,
      });

      await identity.changePassword(cookie, {
        currentPassword: "original secure password",
        newPassword: "replacement secure password",
      });

      await expect(
        identity.loginWithPassword({
          username: "dana",
          password: "original secure password",
        })
      ).rejects.toMatchObject<ApplicationError>({
        code: "INVALID_CREDENTIALS",
      });
      await expect(
        identity.loginWithPassword({
          username: "dana",
          password: "replacement secure password",
        })
      ).resolves.toMatchObject({
        view: { user: { username: "dana" } },
      });
      expect(identity.getSession(cookie)).toMatchObject({
        authenticated: true,
      });
    } finally {
      database.close();
    }
  });

  it("logs in, links, and safely unlinks GitHub identities", async () => {
    const database = openWorkspaceDatabase(":memory:");
    let githubUser = {
      subject: "101",
      username: "octocat",
      displayName: "The Octocat",
      avatarUrl: "https://avatars.example/octocat.png",
    };
    const provider: GitHubOAuthProvider = {
      authorizationUrl: ({ state, codeChallenge }) =>
        `https://github.example/authorize?state=${state}&code_challenge=${codeChallenge}`,
      async exchangeCode() {
        return githubUser;
      },
    };
    const discordProvider: DiscordOAuthProvider = {
      authorizationUrl: ({ state, codeChallenge }) =>
        `https://discord.example/authorize?state=${state}&code_challenge=${codeChallenge}`,
      async exchangeCode() {
        return {
          subject: "discord-101",
          username: "octocat-discord",
          displayName: "Octocat on Discord",
          avatarUrl: null,
        };
      },
    };
    const identity = createIdentityModule({
      repository: new IdentityRepository(database),
      sessionTtlMs: 60_000,
      githubOAuthProvider: provider,
      discordOAuthProvider: discordProvider,
      oauthStateSecret: "test-oauth-state-secret",
      now: () => 1_000,
    });

    try {
      const login = identity.startGitHubOAuth({
        intent: "login",
        returnTo: "/worktrees",
        cookieHeader: undefined,
      });
      const loginState = new URL(login.authorizationUrl).searchParams.get(
        "state"
      );
      const loggedIn = await identity.finishGitHubOAuth({
        code: "login-code",
        state: loginState,
        providerError: undefined,
        oauthCookieHeader: `${identity.githubOAuthCookieName}=${login.cookieValue}`,
        sessionCookieHeader: undefined,
      });
      expect(loggedIn.returnTo).toBe("/worktrees");
      expect(loggedIn.issuedSession?.view).toMatchObject({
        user: { username: "octocat", displayName: "The Octocat" },
        authenticationMethods: {
          password: false,
          externalIdentities: [
            { provider: "github", providerUsername: "octocat" },
          ],
        },
      });
      expect(tableCount(database, "external_identities")).toBe(1);
      const githubCookie = `${identity.cookieName}=${loggedIn.issuedSession!.cookieValue}`;
      const cliLogin = identity.startCliAuthorization();
      expect(
        identity.approveCliAuthorization(githubCookie, cliLogin.userCode)
      ).toMatchObject({ user: { username: "octocat" } });
      expect(identity.exchangeCliAuthorization(cliLogin.deviceCode)).toMatchObject({
        status: "authorized",
        issuedSession: {
          view: {
            user: { id: loggedIn.issuedSession!.view.user.id },
            authenticationMethods: {
              password: false,
              externalIdentities: [{ provider: "github" }],
            },
          },
        },
      });
      expect(() => identity.unlinkGitHub(githubCookie)).toThrowError(
        expect.objectContaining({ code: "CONFLICT" })
      );

      const discordLink = identity.startDiscordOAuth({
        intent: "link",
        returnTo: "/",
        cookieHeader: githubCookie,
      });
      const discordState = new URL(
        discordLink.authorizationUrl
      ).searchParams.get("state");
      await identity.finishDiscordOAuth({
        code: "discord-link-code",
        state: discordState,
        providerError: undefined,
        oauthCookieHeader: `${identity.discordOAuthCookieName}=${discordLink.cookieValue}`,
        sessionCookieHeader: githubCookie,
      });
      expect(identity.unlinkGitHub(githubCookie)).toMatchObject({
        authenticationMethods: {
          password: false,
          externalIdentities: [
            { provider: "discord", providerUsername: "octocat-discord" },
          ],
        },
      });
      expect(() => identity.unlinkDiscord(githubCookie)).toThrowError(
        expect.objectContaining({ code: "CONFLICT" })
      );

      const passwordUser = await identity.registerWithPassword({
        username: "alice",
        displayName: "Alice",
        password: "correct horse battery staple",
      });
      const passwordCookie = `${identity.cookieName}=${passwordUser.cookieValue}`;
      githubUser = {
        subject: "202",
        username: "alicehub",
        displayName: "Alice Hub",
        avatarUrl: "https://avatars.example/alice.png",
      };
      const link = identity.startGitHubOAuth({
        intent: "link",
        returnTo: "/",
        cookieHeader: passwordCookie,
      });
      const linkState = new URL(link.authorizationUrl).searchParams.get(
        "state"
      );
      await identity.finishGitHubOAuth({
        code: "link-code",
        state: linkState,
        providerError: undefined,
        oauthCookieHeader: `${identity.githubOAuthCookieName}=${link.cookieValue}`,
        sessionCookieHeader: passwordCookie,
      });
      expect(identity.getSession(passwordCookie)).toMatchObject({
        authenticationMethods: {
          password: true,
          externalIdentities: [
            { provider: "github", providerUsername: "alicehub" },
          ],
        },
      });
      expect(identity.unlinkGitHub(passwordCookie)).toMatchObject({
        authenticationMethods: {
          password: true,
          externalIdentities: [],
        },
      });
    } finally {
      database.close();
    }
  });

  it("completes a Discord ID-only User profile on later Discord OAuth login", async () => {
    const database = openWorkspaceDatabase(":memory:");
    const discordUserId = "123456789012345678";
    const discordProvider: DiscordOAuthProvider = {
      authorizationUrl: ({ state, codeChallenge }) =>
        `https://discord.example/authorize?state=${state}&code_challenge=${codeChallenge}`,
      async exchangeCode() {
        return {
          subject: discordUserId,
          username: "alice.discord",
          displayName: "Alice on Discord",
          avatarUrl: "https://cdn.discordapp.com/alice.png",
        };
      },
    };
    const identity = createIdentityModule({
      repository: new IdentityRepository(database),
      sessionTtlMs: 60_000,
      discordOAuthProvider: discordProvider,
      oauthStateSecret: "test-oauth-state-secret",
      now: () => 1_000,
    });

    try {
      const botLogin = identity.loginWithDiscordBot({ discordUserId });
      expect(botLogin.view.user).toMatchObject({
        username: `discord-${discordUserId}`,
        displayName: `discord-${discordUserId}`,
        avatarUrl: null,
      });

      const login = identity.startDiscordOAuth({
        intent: "login",
        returnTo: "/",
        cookieHeader: undefined,
      });
      const state = new URL(login.authorizationUrl).searchParams.get("state");
      const completed = await identity.finishDiscordOAuth({
        code: "discord-login-code",
        state,
        providerError: undefined,
        oauthCookieHeader: `${identity.discordOAuthCookieName}=${login.cookieValue}`,
        sessionCookieHeader: undefined,
      });

      expect(completed.issuedSession?.view).toMatchObject({
        user: {
          id: botLogin.view.user.id,
          username: "alice.discord",
          displayName: "Alice on Discord",
          avatarUrl: "https://cdn.discordapp.com/alice.png",
        },
        authenticationMethods: {
          externalIdentities: [
            { provider: "discord", providerUsername: "alice.discord" },
          ],
        },
      });
      expect(tableCount(database, "users")).toBe(1);
      expect(tableCount(database, "spaces")).toBe(1);
      expect(tableCount(database, "external_identities")).toBe(1);
    } finally {
      database.close();
    }
  });
});

function tableCount(
  database: ReturnType<typeof openWorkspaceDatabase>,
  table:
    | "users"
    | "password_credentials"
    | "external_identities"
    | "spaces"
    | "login_sessions"
): number {
  const row = database.connection
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { readonly count: number };
  return row.count;
}
