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
      ["filler", "\u3164", /visible character/u],
      ["braille", "\u2800\u2800", /visible character/u],
      ["isolate", "\u2066\u202E\n", /visible character/u],
    ] as const) {
      const refused = await register(username, displayName);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "INVALID_INPUT", field: "displayName", message: expect.stringMatching(message) } });
    }
    const signedUp = (await (await call(origin, "GET", "/api/session", undefined, { cookie })).json()) as { user: { username: string } };
    expect(signedUp.user.username).toBe("mallory");
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
    const login = async (discordUserId: string, displayName: unknown) => {
      const response = await call(origin, "POST", "/api/auth/discord/bot-login", { discordUserId, displayName }, { "x-api-key": BOT_KEY });
      expect(response.status).toBe(200);
      return ((await response.json()) as { user: { displayName: string } }).user.displayName;
    };
    expect(await login("100000000000000001", "\u202Ebob@example.com\n")).toBe("bob");
    expect(await login("100000000000000002", "\u3164\u2800")).toBe("discord-100000000000000002");
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
