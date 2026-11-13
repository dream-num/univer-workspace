import { createHash, timingSafeEqual } from "node:crypto";
import { json, Router, type Response } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessTokenService, PersonalTokenRecord } from "./access-tokens.js";
import type { IdentityModule } from "./identity.service.js";
import { resolveMcpResource, type McpOAuthConfig } from "./mcp-oauth.js";

const WORKSPACE_AGENTS_CLIENT_ID = "univer-workspace-agents";

export function createIdentityRouter(options: {
  readonly identity: IdentityModule;
  readonly accessTokens: AccessTokenService;
  readonly mcpOAuth: McpOAuthConfig | null;
  readonly secureCookies: boolean;
  readonly discordBotApiKey?: string;
}): Router {
  const router = Router();
  const { identity } = options;
  router.use(json({ limit: "1mb" }));

  router.get("/session", (request, response) => {
    response.json(identity.getSession(request.headers.cookie));
  });

  router.post("/auth/password/register", async (request, response) => {
    const issued = await identity.registerWithPassword({
      username: request.body?.username,
      displayName: request.body?.displayName,
      password: request.body?.password,
    });
    setSessionCookie(response, identity, issued.cookieValue, options);
    response.status(201).json(issued.view);
  });

  router.post("/auth/password/login", async (request, response) => {
    const issued = await identity.loginWithPassword({
      username: request.body?.username,
      password: request.body?.password,
    }, "browser");
    setSessionCookie(response, identity, issued.cookieValue, options);
    response.json(issued.view);
  });

  router.post("/auth/cli/password/login", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const issued = await identity.loginWithPassword({
      username: request.body?.username,
      password: request.body?.password,
    }, "agent");
    setSessionCookie(response, identity, issued.cookieValue, options);
    response.json(issued.view);
  });

  router.post("/auth/email/code", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const issued = await identity.requestEmailLoginCode({
      email: request.body?.email,
    });
    response.status(202).json(issued);
  });

  router.post("/auth/email/login", async (request, response) => {
    const issued = await identity.loginWithEmailCode({
      email: request.body?.email,
      code: request.body?.code,
    });
    setSessionCookie(response, identity, issued.cookieValue, options);
    response.json(issued.view);
  });

  router.post("/auth/cli/authorizations", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.status(201).json(identity.startCliAuthorization());
  });

  router.post("/auth/cli/authorizations/approve", (request, response) => {
    response.set("Cache-Control", "no-store");
    response.json(
      identity.approveCliAuthorization(
        request.headers.cookie,
        request.body?.userCode
      )
    );
  });

  router.post("/auth/cli/authorizations/exchange", (request, response) => {
    response.set("Cache-Control", "no-store");
    const result = identity.exchangeCliAuthorization(
      request.body?.deviceCode
    );
    if (result.status === "pending") {
      response.status(202).json(result);
      return;
    }
    setSessionCookie(
      response,
      identity,
      result.issuedSession.cookieValue,
      options
    );
    response.json(result.issuedSession.view);
  });

  router.post("/auth/discord/bot-login", (request, response) => {
    requireDiscordBotApiKey(
      request.get("x-api-key"),
      options.discordBotApiKey
    );
    const issued = identity.loginWithDiscordBot({
      discordUserId: request.body?.discordUserId,
      username: request.body?.username,
      displayName: request.body?.displayName,
      avatarUrl: request.body?.avatarUrl,
    });
    setSessionCookie(response, identity, issued.cookieValue, options);
    response.json(issued.view);
  });

  router.put("/auth/password", async (request, response) => {
    await identity.changePassword(request.headers.cookie, {
      currentPassword: request.body?.currentPassword,
      newPassword: request.body?.newPassword,
    });
    response.status(204).end();
  });

  router.post("/auth/logout", (request, response) => {
    identity.logout(request.headers.cookie);
    response.clearCookie(identity.cookieName, { path: "/" });
    response.status(204).end();
  });

  router.get("/auth/tokens", (request, response) => {
    response.set("Cache-Control", "no-store");
    const { user } = identity.requireSession(request.headers.cookie);
    response.json({ tokens: options.accessTokens.listPersonalTokens(user.id).map(toTokenView) });
  });

  router.post("/auth/agent-token", (request, response) => {
    response.set("Cache-Control", "no-store");
    const { user } = identity.requireInteractiveSession(request.headers.cookie);
    const scopes: unknown = request.body?.scopes;
    if (!Array.isArray(scopes) || scopes.length > 2 || !scopes.includes("read") ||
      !scopes.every((scope) => scope === "read" || scope === "write" || scope === "publish") ||
      new Set(scopes).size !== scopes.length) {
      throw new ApplicationError("INVALID_INPUT", 400, "scopes must be [read], [read, write], or [read, publish], without duplicates.", "scopes");
    }
    const resource = options.mcpOAuth
      ? resolveMcpResource(options.mcpOAuth, new URL("/mcp", options.mcpOAuth.issuer).href)
      : undefined;
    if (!resource) {
      throw new ApplicationError("OAUTH_CLIENT_UNAVAILABLE", 503, "MCP_RESOURCE_URLS must include the /mcp URL at PUBLIC_ORIGIN to issue agent tokens.");
    }
    const issued = options.accessTokens.issueGrant({ userId: user.id, clientId: WORKSPACE_AGENTS_CLIENT_ID, scopes, resource });
    response.status(201).json({
      token: issued.accessToken,
      expiresAt: issued.grant.accessExpiresAt,
      scopes: issued.grant.scopes,
      resource: issued.grant.resource,
    });
  });

  router.post("/auth/tokens", (request, response) => {
    response.set("Cache-Control", "no-store");
    const { user } = identity.requireInteractiveSession(request.headers.cookie);
    const { name, scopes, expiresAt } = request.body ?? {};
    if (typeof name !== "string") {
      throw new ApplicationError("INVALID_INPUT", 400, "name must be a string.", "name");
    }
    if (scopes !== undefined && !(Array.isArray(scopes) && scopes.every((scope) => typeof scope === "string"))) {
      throw new ApplicationError("INVALID_INPUT", 400, "scopes must be an array of strings.", "scopes");
    }
    const created = options.accessTokens.createPersonalToken({ userId: user.id, name, scopes, expiresAt });
    response.status(201).json({ token: created.token, record: toTokenView(created.record) });
  });

  router.delete("/auth/tokens/:id", (request, response) => {
    const { user } = identity.requireSession(request.headers.cookie);
    if (!options.accessTokens.revokePersonalToken(user.id, request.params.id)) {
      throw new ApplicationError("NOT_FOUND", 404, "The token was not found.");
    }
    response.status(204).end();
  });

  router.get("/auth/github/login", (request, response) => {
    const started = identity.startGitHubOAuth({
      intent: "login",
      returnTo: request.query.returnTo,
      cookieHeader: request.headers.cookie,
    });
    setOAuthCookie(
      response,
      identity.githubOAuthCookieName,
      started.cookieValue,
      options
    );
    response.redirect(started.authorizationUrl);
  });

  router.get("/auth/github/link", (request, response) => {
    const started = identity.startGitHubOAuth({
      intent: "link",
      returnTo: request.query.returnTo,
      cookieHeader: request.headers.cookie,
    });
    setOAuthCookie(
      response,
      identity.githubOAuthCookieName,
      started.cookieValue,
      options
    );
    response.redirect(started.authorizationUrl);
  });

  router.get("/auth/github/callback", async (request, response) => {
    try {
      const result = await identity.finishGitHubOAuth({
        code: request.query.code,
        state: request.query.state,
        providerError: request.query.error,
        oauthCookieHeader: request.headers.cookie,
        sessionCookieHeader: request.headers.cookie,
      });
      if (result.issuedSession) {
        setSessionCookie(
          response,
          identity,
          result.issuedSession.cookieValue,
          options
        );
      }
      response.clearCookie(identity.githubOAuthCookieName, { path: "/" });
      response.redirect(result.returnTo);
    } catch (error) {
      logOAuthFailure("GitHub", error);
      response.clearCookie(identity.githubOAuthCookieName, { path: "/" });
      const message =
        error instanceof Error
          ? error.message
          : "GitHub authentication failed.";
      response.redirect(
        `/login?oauthError=${encodeURIComponent(message)}`
      );
    }
  });

  router.delete("/auth/github", (request, response) => {
    response.json(identity.unlinkGitHub(request.headers.cookie));
  });

  router.get("/auth/google/login", (request, response) => {
    const started = identity.startGoogleOAuth({
      intent: "login",
      returnTo: request.query.returnTo,
      cookieHeader: request.headers.cookie,
    });
    setOAuthCookie(
      response,
      identity.googleOAuthCookieName,
      started.cookieValue,
      options
    );
    response.redirect(started.authorizationUrl);
  });

  router.get("/auth/google/link", (request, response) => {
    const started = identity.startGoogleOAuth({
      intent: "link",
      returnTo: request.query.returnTo,
      cookieHeader: request.headers.cookie,
    });
    setOAuthCookie(
      response,
      identity.googleOAuthCookieName,
      started.cookieValue,
      options
    );
    response.redirect(started.authorizationUrl);
  });

  router.get("/auth/google/callback", async (request, response) => {
    try {
      const result = await identity.finishGoogleOAuth({
        code: request.query.code,
        state: request.query.state,
        providerError: request.query.error,
        oauthCookieHeader: request.headers.cookie,
        sessionCookieHeader: request.headers.cookie,
      });
      if (result.issuedSession) {
        setSessionCookie(
          response,
          identity,
          result.issuedSession.cookieValue,
          options
        );
      }
      response.clearCookie(identity.googleOAuthCookieName, { path: "/" });
      response.redirect(result.returnTo);
    } catch (error) {
      logOAuthFailure("Google", error);
      response.clearCookie(identity.googleOAuthCookieName, { path: "/" });
      const message =
        error instanceof Error
          ? error.message
          : "Google authentication failed.";
      response.redirect(
        `/login?oauthError=${encodeURIComponent(message)}`
      );
    }
  });

  router.delete("/auth/google", (request, response) => {
    response.json(identity.unlinkGoogle(request.headers.cookie));
  });

  router.get("/auth/discord/login", (request, response) => {
    const started = identity.startDiscordOAuth({
      intent: "login",
      returnTo: request.query.returnTo,
      cookieHeader: request.headers.cookie,
    });
    setOAuthCookie(
      response,
      identity.discordOAuthCookieName,
      started.cookieValue,
      options
    );
    response.redirect(started.authorizationUrl);
  });

  router.get("/auth/discord/link", (request, response) => {
    const started = identity.startDiscordOAuth({
      intent: "link",
      returnTo: request.query.returnTo,
      cookieHeader: request.headers.cookie,
    });
    setOAuthCookie(
      response,
      identity.discordOAuthCookieName,
      started.cookieValue,
      options
    );
    response.redirect(started.authorizationUrl);
  });

  router.get("/auth/discord/callback", async (request, response) => {
    try {
      const result = await identity.finishDiscordOAuth({
        code: request.query.code,
        state: request.query.state,
        providerError: request.query.error,
        oauthCookieHeader: request.headers.cookie,
        sessionCookieHeader: request.headers.cookie,
      });
      if (result.issuedSession) {
        setSessionCookie(
          response,
          identity,
          result.issuedSession.cookieValue,
          options
        );
      }
      response.clearCookie(identity.discordOAuthCookieName, { path: "/" });
      response.redirect(result.returnTo);
    } catch (error) {
      logOAuthFailure("Discord", error);
      response.clearCookie(identity.discordOAuthCookieName, { path: "/" });
      const message =
        error instanceof Error
          ? error.message
          : "Discord authentication failed.";
      response.redirect(`/login?oauthError=${encodeURIComponent(message)}`);
    }
  });

  router.delete("/auth/discord", (request, response) => {
    response.json(identity.unlinkDiscord(request.headers.cookie));
  });

  router.patch("/users/me", (request, response) => {
    response.json(
      identity.updateCurrentUser(request.headers.cookie, {
        username: request.body?.username,
        displayName: request.body?.displayName,
        avatarUrl: request.body?.avatarUrl,
      })
    );
  });

  return router;
}

function requireDiscordBotApiKey(
  provided: string | undefined,
  expected: string | undefined
): void {
  if (expected === undefined) {
    throw new ApplicationError(
      "DISCORD_BOT_AUTH_UNAVAILABLE",
      503,
      "Discord Bot authentication is not configured."
    );
  }
  if (provided === undefined || !secretsMatch(provided, expected)) {
    throw new ApplicationError(
      "UNAUTHENTICATED",
      401,
      "A valid Discord Bot API key is required."
    );
  }
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function logOAuthFailure(
  provider: "GitHub" | "Google" | "Discord",
  error: unknown
): void {
  console.error(`[identity] ${provider} OAuth callback failed`, error);
}

function setOAuthCookie(
  response: Response,
  cookieName: string,
  value: string,
  options: { readonly secureCookies: boolean }
): void {
  response.cookie(cookieName, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: options.secureCookies,
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

function setSessionCookie(
  response: Response,
  identity: IdentityModule,
  value: string,
  options: { readonly secureCookies: boolean }
): void {
  response.cookie(identity.cookieName, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: options.secureCookies,
    maxAge: identity.sessionTtlMs,
    path: "/",
  });
}

function toTokenView(record: PersonalTokenRecord) {
  const { userId: _userId, ...view } = record;
  return view;
}
