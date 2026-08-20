import { createHash, timingSafeEqual } from "node:crypto";
import { json, Router, type Response } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import type { IdentityModule } from "./identity.service.js";

export function createIdentityRouter(options: {
  readonly identity: IdentityModule;
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

function logOAuthFailure(provider: "GitHub" | "Discord", error: unknown): void {
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
