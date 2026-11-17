import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceConfig } from "../../server/src/config.js";
import { createSqliteRepositories } from "../../server/src/db/sqlite/open.js";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import { createGoogleOAuthProvider } from "../../server/src/modules/identity/google-oauth.js";
import { createIdentityModule } from "../../server/src/modules/identity/index.js";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";

const BOT_KEY = "test-discord-bot-api-key-at-least-32-characters";
const applications: SqliteTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("display names", () => {
  it("cleans hostile names at sign-up and refuses addresses and invisible names", async () => {
    const origin = await start();
    const register = (username: string, displayName: unknown) =>
      call(origin, "POST", "/api/auth/password/register", { username, displayName, password: "correct horse battery staple" });

    const hostile = await register("mallory", "\u202EMallory\nSmith\u200B");
    expect(hostile.status).toBe(201);
    const cookie = hostile.headers.get("set-cookie")!.split(";", 1)[0]!;
    expect(await hostile.json()).toMatchObject({ user: { displayName: "Mallory Smith" } });
    expect(await personalSpaceName(origin, cookie)).toBe("Mallory Smith 的个人空间");

    for (const [username, displayName, message] of [
      ["alice", "alice@example.com", /cannot contain an email address/u],
      ["spaced", "alice @ example.com", /cannot contain an email address/u],
      ["fullwidth", "alice\uFF20example\u3002com", /cannot contain an email address/u],
      ["mailto", "mailto:alice@example.com", /cannot contain an email address/u],
      ["hidden", "\u3164@example.com", /cannot contain an email address/u],
      ["filler", "\u3164", /visible character/u],
      ["braille", "\u2800\u2800", /visible character/u],
      ["isolate", "\u2066\u202E\n", /visible character/u],
      ["marks", "\u0301\u0301", /visible character/u],
      ["private", "\uE000\uFFFC", /visible character/u],
      ["long", "\u{1F600}".repeat(101), /between 1 and 100 characters/u],
    ] as const) {
      const refused = await register(username, displayName);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "INVALID_INPUT", field: "displayName", message: expect.stringMatching(message) } });
    }
    const signedUp = (await (await call(origin, "GET", "/api/session", undefined, { cookie })).json()) as { user: { username: string } };
    expect(signedUp.user.username).toBe("mallory");

    for (const [username, displayName] of [
      ["family", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} Smith"],
      ["persian", "\u0646\u0627\u0645\u0647\u200C\u0627\u06CC"],
      ["emoji", "\u{1F600}".repeat(100)],
    ]) {
      const kept = await register(username, displayName);
      expect(kept.status).toBe(201);
      expect(await kept.json()).toMatchObject({ user: { displayName } });
    }
  });

  it("refuses a chosen username with a Hangul filler and drops one from a provider username", async () => {
    const origin = await start({ discordBotApiKey: BOT_KEY });
    const refused = { error: { code: "INVALID_INPUT", field: "username", message: "Username cannot contain invisible characters." } };
    const register = await call(origin, "POST", "/api/auth/password/register", { username: "\u3164", displayName: "Hidden", password: "correct horse battery staple" });
    expect(register.status).toBe(400);
    expect(await register.json()).toMatchObject(refused);

    const registered = await call(origin, "POST", "/api/auth/password/register", { username: "visible", displayName: "Visible", password: "correct horse battery staple" });
    const cookie = registered.headers.get("set-cookie")!.split(";", 1)[0]!;
    const rename = await call(origin, "PATCH", "/api/users/me", { username: "vis\u1160ible" }, { cookie });
    expect(rename.status).toBe(400);
    expect(await rename.json()).toMatchObject(refused);
    const unchanged = await call(origin, "PATCH", "/api/users/me", { username: "visible", displayName: "Still visible" }, { cookie });
    expect(unchanged.status).toBe(200);

    const bot = await call(origin, "POST", "/api/auth/discord/bot-login", { discordUserId: "100000000000000009", username: "\u3164" }, { "x-api-key": BOT_KEY });
    expect(bot.status).toBe(200);
    expect(await bot.json()).toMatchObject({ user: { username: "discord-100000000000000009", displayName: "Workspace User" } });
  });

  it("refuses a chosen username shaped like a user ID, keeps a stored one signing in and suffixes a provider one", async () => {
    const origin = await start({ discordBotApiKey: BOT_KEY });
    const userId = "22222222-BBBB-4bbb-8bbb-222222222222";
    const refused = { error: { code: "INVALID_INPUT", field: "username", message: "Username cannot look like a user ID." } };
    const password = "correct horse battery staple";
    const register = await call(origin, "POST", "/api/auth/password/register", { username: userId, displayName: "Spoof", password });
    expect(register.status).toBe(400);
    expect(await register.json()).toMatchObject(refused);

    const registered = await call(origin, "POST", "/api/auth/password/register", { username: "legacy", displayName: "Legacy", password });
    const cookie = registered.headers.get("set-cookie")!.split(";", 1)[0]!;
    const rename = await call(origin, "PATCH", "/api/users/me", { username: userId.toLowerCase() }, { cookie });
    expect(rename.status).toBe(400);
    expect(await rename.json()).toMatchObject(refused);

    applications.at(-1)!.database.connection.prepare("UPDATE users SET username = ? WHERE username = 'legacy'").run(userId);
    const login = await call(origin, "POST", "/api/auth/password/login", { username: userId, password });
    expect(login.status).toBe(200);
    const kept = await call(origin, "PATCH", "/api/users/me", { username: userId, displayName: "Still legacy" }, { cookie });
    expect(kept.status).toBe(200);
    expect(await kept.json()).toMatchObject({ username: userId });

    const bot = await call(origin, "POST", "/api/auth/discord/bot-login", { discordUserId: "100000000000000010", username: userId }, { "x-api-key": BOT_KEY });
    expect(bot.status).toBe(200);
    expect(await bot.json()).toMatchObject({ user: { username: `${userId}-0000000010` } });
  });

  it("renames a default-named Personal Space with its owner and leaves a renamed one alone", async () => {
    const origin = await start();
    const registered = await call(origin, "POST", "/api/auth/password/register", { username: "alice", displayName: "Alice", password: "correct horse battery staple" });
    const cookie = registered.headers.get("set-cookie")!.split(";", 1)[0]!;
    const rename = (displayName: string) => call(origin, "PATCH", "/api/users/me", { displayName }, { cookie });

    expect((await rename("Alicia")).status).toBe(200);
    expect(await personalSpaceName(origin, cookie)).toBe("Alicia 的个人空间");

    const refused = await rename("alicia@example.com");
    expect(refused.status).toBe(400);
    expect(await personalSpaceName(origin, cookie)).toBe("Alicia 的个人空间");

    const space = await personalSpace(origin, cookie);
    expect((await call(origin, "PATCH", `/api/spaces/${space.id}`, { name: "Alicia's drafts" }, { cookie })).status).toBe(200);
    expect((await rename("Ali")).status).toBe(200);
    expect(await personalSpaceName(origin, cookie)).toBe("Alicia's drafts");
  });

  it("derives a clean name for the Discord bot instead of refusing the profile it relays", async () => {
    const origin = await start({ discordBotApiKey: BOT_KEY });
    const login = async (discordUserId: string, displayName: unknown, username?: string) => {
      const response = await call(origin, "POST", "/api/auth/discord/bot-login", { discordUserId, displayName, username }, { "x-api-key": BOT_KEY });
      expect(response.status).toBe(200);
      return ((await response.json()) as { user: { displayName: string } }).user.displayName;
    };
    expect(await login("100000000000000001", "\u202Ebob@example.com\n")).toBe("bob");
    expect(await login("100000000000000002", "\u3164\u2800")).toBe("discord-100000000000000002");
    expect(await login("100000000000000003", "\u200B", "bob")).toBe("bob");
  });

  it("names a Google account without a profile name after its email local part", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "google-token" });
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ sub: "42", email: "alice.example@gmail.com" });
      throw new Error(`Unexpected Google OAuth request: ${url}`);
    }));
    const database = openWorkspaceDatabase(":memory:");
    try {
      const identity = createIdentityModule({
        repository: createSqliteRepositories(database).identity,
        sessionTtlMs: 60_000,
        googleOAuthProvider: createGoogleOAuthProvider({ clientId: "client", clientSecret: "secret", callbackUrl: "https://workspace.example.test/api/auth/google/callback" }),
        oauthStateSecret: "test-oauth-state-secret",
      });
      await identity.initialize();
      const login = await identity.startGoogleOAuth({ intent: "login", returnTo: "/", cookieHeader: undefined });
      const finished = await identity.finishGoogleOAuth({
        code: "code",
        state: new URL(login.authorizationUrl).searchParams.get("state"),
        providerError: undefined,
        oauthCookieHeader: `${identity.googleOAuthCookieName}=${login.cookieValue}`,
        sessionCookieHeader: undefined,
      });
      expect(finished.issuedSession?.view.user).toMatchObject({ username: "alice.example", displayName: "alice.example" });
      expect(database.connection.prepare("SELECT name FROM spaces WHERE type = 'personal'").all().map(({ name }) => name))
        .toEqual(["alice.example 的个人空间"]);
    } finally {
      database.close();
    }
  });
});

async function personalSpace(origin: string, cookie: string): Promise<{ id: string; name: string }> {
  const { spaces } = (await (await call(origin, "GET", "/api/spaces", undefined, { cookie })).json()) as { spaces: { id: string; type: string; name: string }[] };
  return spaces.find(({ type }) => type === "personal")!;
}

async function personalSpaceName(origin: string, cookie: string): Promise<string> {
  return (await personalSpace(origin, cookie)).name;
}

async function start(config: Partial<WorkspaceConfig> = {}): Promise<string> {
  const application = await createSqliteTestApplication({
    host: "127.0.0.1",
    port: 0,
    database: { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
    emailAuth: null,
    ...config,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

function call(origin: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
